import unittest
import sys
import os
import math

# Add parent directory to path to import game package
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game.engine import GameEngine
from game.constants import PASSIVE_SONAR_RANGE, PASSIVE_SONAR_NOISE_BEARING, PASSIVE_SONAR_NOISE_DISTANCE

class TestPassiveSonar(unittest.TestCase):
    def setUp(self):
        self.engine = GameEngine()
        self.sub1 = self.engine.add_player("sid1", "Sub1")
        self.sub2 = self.engine.add_player("sid2", "Sub2")

    def test_passive_detection_within_range(self):
        # Position sub2 within passive range of sub1
        self.sub1.x = 0
        self.sub1.y = 0
        self.sub1.depth = 50
        
        self.sub2.x = PASSIVE_SONAR_RANGE - 10
        self.sub2.y = 0
        self.sub2.depth = 50
        
        state = self.engine.get_state("sid1")
        self.assertIn("passive_contacts", state)
        contacts = state["passive_contacts"]
        self.assertEqual(len(contacts), 1)
        self.assertEqual(contacts[0]["id"], "sid2")

    def test_passive_detection_outside_range(self):
        # Position sub2 outside passive range of sub1
        self.sub1.x = 0
        self.sub1.y = 0
        self.sub1.depth = 50
        
        self.sub2.x = PASSIVE_SONAR_RANGE + 10
        self.sub2.y = 0
        self.sub2.depth = 50
        
        state = self.engine.get_state("sid1")
        self.assertIn("passive_contacts", state)
        contacts = state["passive_contacts"]
        self.assertEqual(len(contacts), 0)

    def test_passive_sonar_noise(self):
        # Position sub2 at a known location
        self.sub1.x = 0
        self.sub1.y = 0
        self.sub1.depth = 50
        
        dist = 100.0
        self.sub2.x = dist
        self.sub2.y = 0
        self.sub2.depth = 50
        
        # True bearing should be 90 degrees (East)
        # Wait, coordinate system: y is up? 
        # engine.py: bearing = (math.degrees(math.atan2(dx, -dy)) + 360.0) % 360.0
        # dx = 100, dy = 0 -> atan2(100, 0) = 90 degrees. Correct.
        
        state = self.engine.get_state("sid1")
        contact = state["passive_contacts"][0]
        
        reported_dist = contact["distance"]
        reported_bearing = contact["bearing"]
        
        # Check noise limits
        # Distance noise is +/- PASSIVE_SONAR_NOISE_DISTANCE (percentage)
        min_dist = dist * (1.0 - PASSIVE_SONAR_NOISE_DISTANCE)
        max_dist = dist * (1.0 + PASSIVE_SONAR_NOISE_DISTANCE)
        self.assertTrue(min_dist <= reported_dist <= max_dist, f"Distance {reported_dist} out of range [{min_dist}, {max_dist}]")
        
        # Bearing noise is +/- PASSIVE_SONAR_NOISE_BEARING
        # Handle wrapping if close to 0/360, but here we are at 90.
        min_bearing = 90.0 - PASSIVE_SONAR_NOISE_BEARING
        max_bearing = 90.0 + PASSIVE_SONAR_NOISE_BEARING
        self.assertTrue(min_bearing <= reported_bearing <= max_bearing, f"Bearing {reported_bearing} out of range [{min_bearing}, {max_bearing}]")

    def test_passive_detection_does_not_alert_target(self):
        # Position sub2 within passive range
        self.sub1.x = 0
        self.sub1.y = 0
        self.sub2.x = 100
        self.sub2.y = 0
        
        # Get state for sub1 (detecting sub2)
        state1 = self.engine.get_state("sid1")
        self.assertEqual(len(state1["passive_contacts"]), 1)
        
        # Get state for sub2 (should NOT be alerted)
        # Active sonar alerts come via 'sonar_ping_detected' event or similar, 
        # but 'get_state' doesn't return alerts directly, they are events from 'perform_sonar_ping'.
        # However, 'get_state' returns 'sonar_contacts' for active pings if they were recent.
        # Passive sonar is just state.
        # We need to ensure that getting state for sub1 doesn't somehow trigger an event for sub2.
        # 'get_state' is side-effect free regarding other players usually.
        
        # Let's check that sub2 doesn't see sub1 if sub1 is just sitting there (passive).
        state2 = self.engine.get_state("sid2")
        # sub1 is within range of sub2, so sub2 should see sub1 passively.
        self.assertEqual(len(state2["passive_contacts"]), 1)
        
        # But sub2 should NOT see sub1 in active contacts
        self.assertEqual(len(state2["sonar_contacts"]), 0)

if __name__ == '__main__':
    unittest.main()

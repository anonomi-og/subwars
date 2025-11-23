import unittest
import sys
import os

# Add parent directory to path to import game package
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game.engine import GameEngine
from game.constants import SUB_MAX_SPEED

class TestGameEngine(unittest.TestCase):
    def setUp(self):
        self.engine = GameEngine()

    def test_add_remove_player(self):
        sub = self.engine.add_player("sid1", "Captain Nemo")
        self.assertIsNotNone(sub)
        self.assertEqual(sub.username, "Captain Nemo")
        self.assertIn("sid1", self.engine.submarines)
        
        removed = self.engine.remove_player("sid1")
        self.assertEqual(removed, sub)
        self.assertNotIn("sid1", self.engine.submarines)

    def test_movement(self):
        sub = self.engine.add_player("sid1", "Test")
        # Set speed to max
        self.engine.update_controls("sid1", {"speed": 4.0}) # 4.0 is max order
        
        # Update engine for 1 second
        self.engine.update()
        # Sub should have accelerated
        self.assertGreater(sub.speed, 0)
        
        # Update for more time to move
        initial_x = sub.x
        initial_y = sub.y
        
        # Simulate 100 ticks of 0.1s
        for _ in range(100):
            sub.update(0.1)
            
        # Should have moved
        self.assertNotEqual(sub.x, initial_x)
        self.assertNotEqual(sub.y, initial_y)

    def test_fire_torpedo(self):
        self.engine.add_player("sid1", "Shooter")
        torp_id = self.engine.fire_torpedo("sid1")
        self.assertIsNotNone(torp_id)
        self.assertEqual(len(self.engine.torpedoes), 1)
        self.assertEqual(self.engine.torpedoes[0].owner_id, "sid1")

if __name__ == '__main__':
    unittest.main()

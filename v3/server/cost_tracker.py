"""
Instance Cost Tracker - Tracks GPU session costs for Vast.ai instances.

Logs hourly cost estimates, cumulative session cost, and alerts when daily
spending exceeds a configurable threshold. Persists cost data to a JSON file
so costs accumulate across server restarts within the same day.
"""
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, Optional


# Default cost rate ($/hour) - typical Vast.ai RTX 3090 rate
DEFAULT_HOURLY_RATE = 0.10

# Default daily spending alert threshold
DEFAULT_DAILY_ALERT_THRESHOLD = 2.00

# Path to persist cost data
COST_DATA_PATH = "/tmp/gpu_cost.json"

# How often to log cost updates (seconds)
COST_LOG_INTERVAL = 300  # Every 5 minutes


class CostTracker:
    """Tracks GPU instance cost per session and per day.

    Usage:
        tracker = CostTracker(hourly_rate=0.10)
        tracker.start_session()

        # Periodically (e.g., in telemetry loop):
        tracker.update()

        # At race end:
        tracker.log_session_cost("Race completed")

        # Check for daily overspend:
        if tracker.is_over_budget():
            print("WARNING: Over daily budget!")
    """

    def __init__(self, hourly_rate: float = DEFAULT_HOURLY_RATE,
                 daily_threshold: float = DEFAULT_DAILY_ALERT_THRESHOLD,
                 cost_data_path: str = COST_DATA_PATH):
        self.hourly_rate = hourly_rate
        self.daily_threshold = daily_threshold
        self._cost_data_path = cost_data_path

        # Session tracking
        self._session_start: Optional[float] = None
        self._session_id: str = ""
        self._last_log_time: float = 0.0

        # Daily cost accumulator (loaded from file)
        self._daily_costs: Dict = self._load_cost_data()
        self._alert_sent = False

    def _load_cost_data(self) -> Dict:
        """Load persisted cost data from JSON file.

        Returns a dict with structure:
        {
            "date": "2026-02-20",
            "total_cost": 0.45,
            "sessions": [
                {"start": 1708387200, "duration_hours": 1.5, "cost": 0.15},
                ...
            ]
        }
        """
        try:
            if os.path.exists(self._cost_data_path):
                with open(self._cost_data_path, 'r') as f:
                    data = json.load(f)
                # Reset if it's a new day
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                if data.get("date") != today:
                    print(f"[cost] New day detected ({data.get('date')} -> {today}), resetting cost data")
                    return {"date": today, "total_cost": 0.0, "sessions": []}
                return data
        except Exception as e:
            print(f"[cost] Failed to load cost data: {e}")

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return {"date": today, "total_cost": 0.0, "sessions": []}

    def _save_cost_data(self):
        """Persist cost data to JSON file."""
        try:
            with open(self._cost_data_path, 'w') as f:
                json.dump(self._daily_costs, f, indent=2)
        except Exception as e:
            print(f"[cost] Failed to save cost data: {e}")

    def start_session(self):
        """Mark the start of a new session (e.g., when a race starts).

        Records the start time for cost calculation. Multiple calls are safe;
        each call begins a new session and finalizes the previous one.
        """
        # Finalize previous session if one was active
        if self._session_start is not None:
            self.log_session_cost("session ended (new session starting)")

        self._session_start = time.time()
        self._session_id = f"session_{int(self._session_start)}"
        self._last_log_time = self._session_start
        self._alert_sent = False

        duration_today = self.get_daily_cost() / self.hourly_rate if self.hourly_rate > 0 else 0
        print(f"[cost] Session started. Rate: ${self.hourly_rate:.2f}/hr. "
              f"Daily total so far: ${self.get_daily_cost():.2f} "
              f"({duration_today:.1f}hr). Threshold: ${self.daily_threshold:.2f}/day")

    def update(self):
        """Periodic cost update. Call from the race/telemetry loop.

        Logs cost estimate every COST_LOG_INTERVAL seconds and checks
        the daily spending threshold.
        """
        if self._session_start is None:
            return

        now = time.time()
        if now - self._last_log_time < COST_LOG_INTERVAL:
            return

        self._last_log_time = now
        session_hours = (now - self._session_start) / 3600.0
        session_cost = session_hours * self.hourly_rate
        daily_total = self.get_daily_cost() + session_cost

        print(f"[cost] Session: {session_hours:.2f}hr (${session_cost:.3f}). "
              f"Daily total: ${daily_total:.3f}")

        # Check daily threshold
        if daily_total >= self.daily_threshold and not self._alert_sent:
            self._alert_sent = True
            print(f"[cost] WARNING: Daily spending ${daily_total:.2f} exceeds "
                  f"threshold ${self.daily_threshold:.2f}!")

    def log_session_cost(self, reason: str = "race ended"):
        """Log the cumulative cost of the current session and persist it.

        Called at race end or when the session changes.

        Args:
            reason: Human-readable reason for ending the session.
        """
        if self._session_start is None:
            return

        now = time.time()
        session_hours = (now - self._session_start) / 3600.0
        session_cost = session_hours * self.hourly_rate

        # Record this session
        session_record = {
            "start": self._session_start,
            "duration_hours": round(session_hours, 3),
            "cost": round(session_cost, 4),
            "reason": reason,
        }
        self._daily_costs["sessions"].append(session_record)
        self._daily_costs["total_cost"] = round(
            self._daily_costs["total_cost"] + session_cost, 4
        )

        # Check if date rolled over
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self._daily_costs.get("date") != today:
            print(f"[cost] Day rolled over. Previous day total: "
                  f"${self._daily_costs['total_cost']:.2f}")
            self._daily_costs = {
                "date": today,
                "total_cost": round(session_cost, 4),
                "sessions": [session_record],
            }

        self._save_cost_data()

        daily_total = self._daily_costs["total_cost"]
        print(f"[cost] Session ended ({reason}): {session_hours:.2f}hr, "
              f"${session_cost:.3f}. Daily total: ${daily_total:.3f}")

        # Reset session
        self._session_start = None
        self._session_id = ""

    def get_session_cost(self) -> float:
        """Return the current session cost in dollars."""
        if self._session_start is None:
            return 0.0
        session_hours = (time.time() - self._session_start) / 3600.0
        return session_hours * self.hourly_rate

    def get_daily_cost(self) -> float:
        """Return the total daily cost (excluding the current active session)."""
        return self._daily_costs.get("total_cost", 0.0)

    def get_total_daily_cost(self) -> float:
        """Return the total daily cost including the current active session."""
        return self.get_daily_cost() + self.get_session_cost()

    def is_over_budget(self) -> bool:
        """Check if daily spending exceeds the threshold."""
        return self.get_total_daily_cost() >= self.daily_threshold

    def get_cost_summary(self) -> Dict:
        """Return a cost summary dict for logging or API responses."""
        return {
            "hourly_rate": self.hourly_rate,
            "session_cost": round(self.get_session_cost(), 4),
            "daily_cost": round(self.get_total_daily_cost(), 4),
            "daily_threshold": self.daily_threshold,
            "over_budget": self.is_over_budget(),
            "sessions_today": len(self._daily_costs.get("sessions", [])),
            "date": self._daily_costs.get("date", ""),
        }

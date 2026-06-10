"""
Tuning constants for the BRS (Badminton Rating System) algorithm.

These are the knobs. Change them to tune algorithm behavior.
Document why you changed each one.
"""

# Glicko-2 system constant.
# Controls how much volatility can change per rating period.
# Lower = more stable ratings, slower to reflect real changes.
# Higher = more responsive, but noisier.
# Typical range: 0.3 – 1.2
TAU = 0.5

# RD decay per month of inactivity (in internal Glicko units before scaling).
# A player inactive for 6 months will have their RD grown by ~90 points.
# This models uncertainty growing when we haven't seen someone play.
DECAY_PER_MONTH = 15.0

# Score differential tanh scaling constant.
# Higher k = steeper curve, score margin matters more.
# Lower k = flatter curve, score margin matters less.
# At k=3.5: 21-15 gives ~0.72, 21-19 gives ~0.58
SDF_K = 3.5

# Match type weights — how much each match type scales the rating update.
MATCH_WEIGHTS = {
    "casual": 0.6,
    "club": 1.0,
    "tournament": 1.4,
}

# Minimum matches before a rating is considered "stable".
# Below this, show "Still calibrating" to the player.
CALIBRATION_MATCH_COUNT = 15

# RD threshold for "calibrating" display to player.
RD_CALIBRATING_THRESHOLD = 150.0

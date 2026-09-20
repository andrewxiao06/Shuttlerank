"""Alias for the rating-application module, which lives in the private core package."""
import sys

from badminton_rating.engine import categories as _impl

sys.modules[__name__] = _impl

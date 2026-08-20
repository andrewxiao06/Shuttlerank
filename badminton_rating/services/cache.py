import redis.asyncio as redis 
import os 

_client: "redis.Redis | None" = None

def get_redis() -> redis.Redis:
    """
    Get a Redis client. Creates one if it doesn't exist yet.
    """
    global _client
    if _client is None:
        _client = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
        
    return _client


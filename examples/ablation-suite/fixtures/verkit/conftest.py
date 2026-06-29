import pytest
import verkit


@pytest.fixture
def version():
    """A Release used by several tests."""
    return verkit.Release(
        major=1, minor=2, patch=3, prerelease="alpha.1.2", build="build.11.e0f985a"
    )

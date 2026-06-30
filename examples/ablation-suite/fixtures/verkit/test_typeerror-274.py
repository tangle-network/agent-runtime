import pytest
import verkit


def test_should_work_with_string_and_bytes():
    result = verkit.compare("1.1.0", b"1.2.2")
    assert result == -1
    result = verkit.compare(b"1.1.0", "1.2.2")
    assert result == -1


def test_should_not_work_with_invalid_args():
    with pytest.raises(TypeError):
        verkit.Release.parse(8)

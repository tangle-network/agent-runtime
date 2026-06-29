"""Stub: every function/method below raises NotImplementedError. Keep the
signatures, implement the bodies so the test suite passes. Read the tests to
recover the exact behaviour (ordering rules, formats, edge cases, error
contracts) — they are the only specification."""
"""Release handling by a release-version version class."""
import re
from functools import wraps
from typing import Any, ClassVar, Dict, Iterable, Optional, Pattern, SupportsInt, Tuple, Union, cast, Callable, Collection, Type, TypeVar
ReleasePart = Union[int, Optional[str]]
ReleaseTuple = Tuple[int, int, int, Optional[str], Optional[str]]
ReleaseDict = Dict[str, ReleasePart]
ReleaseIterator = Iterable[ReleasePart]
String = Union[str, bytes]
Comparable = Union['Release', Dict[str, ReleasePart], Collection[ReleasePart], str]
Comparator = Callable[['Release', Comparable], bool]
T = TypeVar('T', bound='Release')
T_cmp = TypeVar('T_cmp', tuple, str, int)

def _comparator(operator: Comparator) -> Comparator:
    """Wrap a Release binary op method in a type-check."""

    @wraps(operator)
    def wrapper(self: 'Release', other: Comparable) -> bool:
        raise NotImplementedError
    return wrapper

def _cmp(a: T_cmp, b: T_cmp) -> int:
    """Return negative if a<b, zero if a==b, positive if a>b."""
    raise NotImplementedError

class Release:
    """
    A three-part release-version value type.

    Versions order as MAJOR.MINOR.PATCH with an optional prerelease and build.

    :param major: version when you make incompatible API changes.
    :param minor: version when you add functionality in a backwards-compatible manner.
    :param patch: version when you make backwards-compatible bug fixes.
    :param prerelease: an optional prerelease string
    :param build: an optional build string
    """
    __slots__ = ('_major', '_minor', '_patch', '_prerelease', '_build')
    NAMES: ClassVar[Tuple[str, ...]] = tuple([item[1:] for item in __slots__])
    _LAST_NUMBER: ClassVar[Pattern[str]] = re.compile('(?:[^\\d]*(\\d+)[^\\d]*)+')
    _REGEX_TEMPLATE: ClassVar[str] = '\n            ^\n            (?P<major>0|[1-9]\\d*)\n            (?:\n                \\.\n                (?P<minor>0|[1-9]\\d*)\n                (?:\n                    \\.\n                    (?P<patch>0|[1-9]\\d*)\n                ){opt_patch}\n            ){opt_minor}\n            (?:-(?P<prerelease>\n                (?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)\n                (?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*\n            ))?\n            (?:\\+(?P<build>\n                [0-9a-zA-Z-]+\n                (?:\\.[0-9a-zA-Z-]+)*\n            ))?\n            $\n        '
    _REGEX: ClassVar[Pattern[str]] = re.compile(_REGEX_TEMPLATE.format(opt_patch='', opt_minor=''), re.VERBOSE)
    _REGEX_OPTIONAL_MINOR_AND_PATCH: ClassVar[Pattern[str]] = re.compile(_REGEX_TEMPLATE.format(opt_patch='?', opt_minor='?'), re.VERBOSE)

    def __init__(self, major: SupportsInt, minor: SupportsInt=0, patch: SupportsInt=0, prerelease: Optional[Union[String, int]]=None, build: Optional[Union[String, int]]=None):
        raise NotImplementedError

    @classmethod
    def _nat_cmp(cls, a: Optional[str], b: Optional[str]) -> int:
        raise NotImplementedError

    @property
    def major(self) -> int:
        """The major part of a version (read-only)."""
        raise NotImplementedError

    @major.setter
    def major(self, value):
        raise NotImplementedError

    @property
    def minor(self) -> int:
        """The minor part of a version (read-only)."""
        raise NotImplementedError

    @minor.setter
    def minor(self, value):
        raise NotImplementedError

    @property
    def patch(self) -> int:
        """The patch part of a version (read-only)."""
        raise NotImplementedError

    @patch.setter
    def patch(self, value):
        raise NotImplementedError

    @property
    def prerelease(self) -> Optional[str]:
        """The prerelease part of a version (read-only)."""
        raise NotImplementedError

    @prerelease.setter
    def prerelease(self, value):
        raise NotImplementedError

    @property
    def build(self) -> Optional[str]:
        """The build part of a version (read-only)."""
        raise NotImplementedError

    @build.setter
    def build(self, value):
        raise NotImplementedError

    def to_tuple(self) -> ReleaseTuple:
        """
        Convert the Release object to a tuple.

        .. versionadded:: 2.10.0
           Renamed :meth:`Release._astuple` to :meth:`Release.to_tuple` to
           make this function available in the public API.

        :return: a tuple with all the parts

        >>> verkit.Release(5, 3, 1).to_tuple()
        (5, 3, 1, None, None)
        """
        raise NotImplementedError

    def to_dict(self) -> ReleaseDict:
        """
        Convert the Release object to an dict.

        .. versionadded:: 2.10.0
           Renamed :meth:`Release._asdict` to :meth:`Release.to_dict` to
           make this function available in the public API.

        :return: an dict with the keys in the order ``major``, ``minor``,
          ``patch``, ``prerelease``, and ``build``.

        >>> verkit.Release(3, 2, 1).to_dict()
        {'major': 3, 'minor': 2, 'patch': 1, 'prerelease': None, 'build': None}
        """
        raise NotImplementedError

    def __iter__(self) -> ReleaseIterator:
        """Return iter(self)."""
        raise NotImplementedError

    @staticmethod
    def _increment_string(string: str) -> str:
        """
        Look for the last sequence of number(s) in a string and increment.

        :param string: the string to search for.
        :return: the incremented string

        Source:
        http://code.activestate.com/recipes/442460-increment-numbers-in-a-string/#c1
        """
        raise NotImplementedError

    def bump_major(self) -> 'Release':
        """
        Raise the major part of the version, return a new object but leave self
        untouched.

        :return: new object with the raised major part

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_major()
        Release(major=4, minor=0, patch=0, prerelease=None, build=None)
        """
        raise NotImplementedError

    def bump_minor(self) -> 'Release':
        """
        Raise the minor part of the version, return a new object but leave self
        untouched.

        :return: new object with the raised minor part

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_minor()
        Release(major=3, minor=5, patch=0, prerelease=None, build=None)
        """
        raise NotImplementedError

    def bump_patch(self) -> 'Release':
        """
        Raise the patch part of the version, return a new object but leave self
        untouched.

        :return: new object with the raised patch part

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_patch()
        Release(major=3, minor=4, patch=6, prerelease=None, build=None)
        """
        raise NotImplementedError

    def bump_prerelease(self, token: Optional[str]='rc') -> 'Release':
        """
        Raise the prerelease part of the version, return a new object but leave
        self untouched.

        :param token: defaults to ``'rc'``
        :return: new :class:`Release` object with the raised prerelease part.
            The original object is not modified.

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_prerelease().prerelease
        'rc.2'
        >>> ver.bump_prerelease('').prerelease
        '1'
        >>> ver.bump_prerelease(None).prerelease
        'rc.1'
        """
        raise NotImplementedError

    def bump_build(self, token: Optional[str]='build') -> 'Release':
        """
        Raise the build part of the version, return a new object but leave self
        untouched.

        :param token: defaults to ``'build'``
        :return: new :class:`Release` object with the raised build part.
            The original object is not modified.

        >>> ver = verkit.parse("3.4.5-rc.1+build.9")
        >>> ver.bump_build()
        Release(major=3, minor=4, patch=5, prerelease='rc.1', build='build.10')
        """
        raise NotImplementedError

    def compare(self, other: Comparable) -> int:
        """
        Compare self with other.

        :param other: the second version
        :return: The return value is negative if ver1 < ver2,
             zero if ver1 == ver2 and strictly positive if ver1 > ver2

        >>> Release.parse("1.0.0").compare("2.0.0")
        -1
        >>> Release.parse("2.0.0").compare("1.0.0")
        1
        >>> Release.parse("2.0.0").compare("2.0.0")
        0
        """
        raise NotImplementedError

    def next_version(self, part: str, prerelease_token: str='rc') -> 'Release':
        """
        Determines next version, preserving natural order.

        .. versionadded:: 2.10.0

        This function is taking prereleases into account.
        The "major", "minor", and "patch" raises the respective parts like
        the ``bump_*`` functions. The real difference is using the
        "prerelease" part. It gives you the next patch version of the
        prerelease, for example:

        >>> str(verkit.parse("0.1.4").next_version("prerelease"))
        '0.1.5-rc.1'

        :param part: One of "major", "minor", "patch", or "prerelease"
        :param prerelease_token: prefix string of prerelease, defaults to 'rc'
        :return: new object with the appropriate part raised
        """
        raise NotImplementedError

    @_comparator
    def __eq__(self, other: Comparable) -> bool:
        raise NotImplementedError

    @_comparator
    def __ne__(self, other: Comparable) -> bool:
        raise NotImplementedError

    @_comparator
    def __lt__(self, other: Comparable) -> bool:
        raise NotImplementedError

    @_comparator
    def __le__(self, other: Comparable) -> bool:
        raise NotImplementedError

    @_comparator
    def __gt__(self, other: Comparable) -> bool:
        raise NotImplementedError

    @_comparator
    def __ge__(self, other: Comparable) -> bool:
        raise NotImplementedError

    def __getitem__(self, index: Union[int, slice]) -> Union[int, Optional[str], Tuple[Union[int, str], ...]]:
        """
        self.__getitem__(index) <==> self[index] Implement getitem.

        If the part  requested is undefined, or a part of the range requested
        is undefined, it will throw an index error.
        Negative indices are not supported.

        :param index: a positive integer indicating the
               offset or a :func:`slice` object
        :raises IndexError: if index is beyond the range or a part is None
        :return: the requested part of the version at position index

        >>> ver = verkit.Release.parse("3.4.5")
        >>> ver[0], ver[1], ver[2]
        (3, 4, 5)
        """
        raise NotImplementedError

    def __repr__(self) -> str:
        raise NotImplementedError

    def __str__(self) -> str:
        raise NotImplementedError

    def __hash__(self) -> int:
        raise NotImplementedError

    def finalize_version(self) -> 'Release':
        """
        Remove any prerelease and build metadata from the version.

        :return: a new instance with the finalized version string

        >>> str(verkit.Release.parse('1.2.3-rc.5').finalize_version())
        '1.2.3'
        """
        raise NotImplementedError

    def match(self, match_expr: str) -> bool:
        """
        Compare self to match a match expression.

        :param match_expr: optional operator and version; valid operators are
              ``<``   smaller than
              ``>``   greater than
              ``>=``  greator or equal than
              ``<=``  smaller or equal than
              ``==``  equal
              ``!=``  not equal
        :return: True if the expression matches the version, otherwise False

        >>> verkit.Release.parse("2.0.0").match(">=1.0.0")
        True
        >>> verkit.Release.parse("1.0.0").match(">1.0.0")
        False
        >>> verkit.Release.parse("4.0.4").match("4.0.4")
        True
        """
        raise NotImplementedError

    @classmethod
    def parse(cls: Type[T], version: String, optional_minor_and_patch: bool=False) -> T:
        """
        Parse version string to a Release instance.

        .. versionchanged:: 2.11.0
           Changed method from static to classmethod to
           allow subclasses.
        .. versionchanged:: 3.0.0
           Added optional parameter ``optional_minor_and_patch`` to allow
           optional minor and patch parts.

        :param version: version string
        :param optional_minor_and_patch: if set to true, the version string to parse            can contain optional minor and patch parts. Optional parts are set to zero.
           By default (False), the version string to parse has to follow the verkit
           specification.
        :return: a new :class:`Release` instance
        :raises ValueError: if version is invalid
        :raises TypeError: if version contains the wrong type

        >>> verkit.Release.parse('3.4.5-pre.2+build.4')
        Release(major=3, minor=4, patch=5, prerelease='pre.2', build='build.4')
        """
        raise NotImplementedError

    def replace(self, **parts: Union[int, Optional[str]]) -> 'Release':
        """
        Replace one or more parts of a version and return a new :class:`Release`
        object, but leave self untouched.

        .. versionadded:: 2.9.0
           Added :func:`Release.replace`

        :param parts: the parts to be updated. Valid keys are:
          ``major``, ``minor``, ``patch``, ``prerelease``, or ``build``
        :return: the new :class:`~verkit.Release` object with
          the changed parts
        :raises TypeError: if ``parts`` contain invalid keys
        """
        raise NotImplementedError

    @classmethod
    def is_valid(cls, version: str) -> bool:
        """
        Check if the string is a valid verkit version.

        .. versionadded:: 2.9.1

        .. versionchanged:: 3.0.0
           Renamed from :meth:`~verkit.Release.isvalid`

        :param version: the version string to check
        :return: True if the version string is a valid verkit version, False
                 otherwise.
        """
        raise NotImplementedError

    def is_compatible(self, other: 'Release') -> bool:
        """
        Check if current version is compatible with other version.

        The result is True, if either of the following is true:

        * both versions are equal, or
        * both majors are equal and higher than 0. Same for both minors.
          Both pre-releases are equal, or
        * both majors are equal and higher than 0. The minor of b's
          minor version is higher then a's. Both pre-releases are equal.

        The algorithm does *not* check patches.

        .. versionadded:: 3.0.0

        :param other: the version to check for compatibility
        :return: True, if ``other`` is compatible with the old version,
                 otherwise False

        >>> Release(1, 1, 0).is_compatible(Release(1, 0, 0))
        False
        >>> Release(1, 0, 0).is_compatible(Release(1, 1, 0))
        True
        """
        raise NotImplementedError
ReleaseInfo = Release

def parse(version):
    """Parse a version string into a dict with keys major, minor, patch,
    prerelease, build (prerelease/build are None when absent)."""
    raise NotImplementedError

def parse_version_info(version):
    """Parse a version string into a Release instance."""
    raise NotImplementedError

def compare(ver1, ver2):
    """Compare two version strings; negative/zero/positive if ver1 is
    lower/equal/greater than ver2."""
    raise NotImplementedError

def match(version, match_expr):
    """Return whether a version string satisfies a match expression such as
    '>=1.0.0' (operators: <, >, ==, <=, >=, !=)."""
    raise NotImplementedError

def max_ver(ver1, ver2):
    """Return the greater of two version strings (as a string)."""
    raise NotImplementedError

def min_ver(ver1, ver2):
    """Return the smaller of two version strings (as a string)."""
    raise NotImplementedError

def format_version(major, minor, patch, prerelease=None, build=None):
    """Format the parts into a version string."""
    raise NotImplementedError

def finalize_version(version):
    """Return the version string with prerelease and build metadata removed."""
    raise NotImplementedError

def bump_major(version):
    """Return the version string with the major part raised."""
    raise NotImplementedError

def bump_minor(version):
    """Return the version string with the minor part raised."""
    raise NotImplementedError

def bump_patch(version):
    """Return the version string with the patch part raised."""
    raise NotImplementedError

def bump_prerelease(version, token='rc'):
    """Return the version string with the prerelease part raised."""
    raise NotImplementedError

def bump_build(version, token='build'):
    """Return the version string with the build part raised."""
    raise NotImplementedError

def replace(version, **parts):
    """Return the version string with one or more parts replaced. Valid keys:
    major, minor, patch, prerelease, build."""
    raise NotImplementedError

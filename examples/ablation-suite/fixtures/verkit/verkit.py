"""Release handling by a release-version version class."""

import re
from functools import wraps
from typing import (
    Any,
    ClassVar,
    Dict,
    Iterable,
    Optional,
    Pattern,
    SupportsInt,
    Tuple,
    Union,
    cast,
    Callable,
    Collection,
    Type,
    TypeVar,
)

# Inlined typing aliases (originally verkit._types), kept self-contained.
ReleasePart = Union[int, Optional[str]]
ReleaseTuple = Tuple[int, int, int, Optional[str], Optional[str]]
ReleaseDict = Dict[str, ReleasePart]
ReleaseIterator = Iterable[ReleasePart]
String = Union[str, bytes]

# These types are required here because of circular imports
Comparable = Union["Release", Dict[str, ReleasePart], Collection[ReleasePart], str]
Comparator = Callable[["Release", Comparable], bool]

T = TypeVar("T", bound="Release")
T_cmp = TypeVar("T_cmp", tuple, str, int)


def _comparator(operator: Comparator) -> Comparator:
    """Wrap a Release binary op method in a type-check."""

    @wraps(operator)
    def wrapper(self: "Release", other: Comparable) -> bool:
        comparable_types = (
            type(self),
            dict,
            tuple,
            list,
            *String.__args__,  # type: ignore
        )
        if not isinstance(other, comparable_types):
            return NotImplemented
        return operator(self, other)

    return wrapper


def _cmp(a: T_cmp, b: T_cmp) -> int:
    """Return negative if a<b, zero if a==b, positive if a>b."""
    return (a > b) - (a < b)


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

    __slots__ = ("_major", "_minor", "_patch", "_prerelease", "_build")

    #: The names of the different parts of a version
    NAMES: ClassVar[Tuple[str, ...]] = tuple([item[1:] for item in __slots__])

    #: Regex for number in a prerelease
    _LAST_NUMBER: ClassVar[Pattern[str]] = re.compile(r"(?:[^\d]*(\d+)[^\d]*)+")
    #: Regex template for a verkit version
    _REGEX_TEMPLATE: ClassVar[
        str
    ] = r"""
            ^
            (?P<major>0|[1-9]\d*)
            (?:
                \.
                (?P<minor>0|[1-9]\d*)
                (?:
                    \.
                    (?P<patch>0|[1-9]\d*)
                ){opt_patch}
            ){opt_minor}
            (?:-(?P<prerelease>
                (?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)
                (?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*
            ))?
            (?:\+(?P<build>
                [0-9a-zA-Z-]+
                (?:\.[0-9a-zA-Z-]+)*
            ))?
            $
        """
    #: Regex for a verkit version
    _REGEX: ClassVar[Pattern[str]] = re.compile(
        _REGEX_TEMPLATE.format(opt_patch="", opt_minor=""),
        re.VERBOSE,
    )
    #: Regex for a verkit version that might be shorter
    _REGEX_OPTIONAL_MINOR_AND_PATCH: ClassVar[Pattern[str]] = re.compile(
        _REGEX_TEMPLATE.format(opt_patch="?", opt_minor="?"),
        re.VERBOSE,
    )

    def __init__(
        self,
        major: SupportsInt,
        minor: SupportsInt = 0,
        patch: SupportsInt = 0,
        prerelease: Optional[Union[String, int]] = None,
        build: Optional[Union[String, int]] = None,
    ):
        # Build a dictionary of the arguments except prerelease and build
        version_parts = {"major": int(major), "minor": int(minor), "patch": int(patch)}

        for name, value in version_parts.items():
            if value < 0:
                raise ValueError(
                    "{!r} is negative. A version can only be positive.".format(name)
                )

        self._major = version_parts["major"]
        self._minor = version_parts["minor"]
        self._patch = version_parts["patch"]
        self._prerelease = None if prerelease is None else str(prerelease)
        self._build = None if build is None else str(build)

    @classmethod
    def _nat_cmp(cls, a: Optional[str], b: Optional[str]) -> int:
        def cmp_prerelease_tag(a, b):
            if isinstance(a, int) and isinstance(b, int):
                return _cmp(a, b)
            elif isinstance(a, int):
                return -1
            elif isinstance(b, int):
                return 1
            else:
                return _cmp(a, b)

        a_parts = [int(x) if x.isdigit() else x for x in (a or "").split(".")]
        b_parts = [int(x) if x.isdigit() else x for x in (b or "").split(".")]

        for sub_a, sub_b in zip(a_parts, b_parts):
            cmp_result = cmp_prerelease_tag(sub_a, sub_b)
            if cmp_result != 0:
                return cmp_result

        return _cmp(len(a_parts), len(b_parts))

    @property
    def major(self) -> int:
        """The major part of a version (read-only)."""
        return self._major

    @major.setter
    def major(self, value):
        raise AttributeError("attribute 'major' is readonly")

    @property
    def minor(self) -> int:
        """The minor part of a version (read-only)."""
        return self._minor

    @minor.setter
    def minor(self, value):
        raise AttributeError("attribute 'minor' is readonly")

    @property
    def patch(self) -> int:
        """The patch part of a version (read-only)."""
        return self._patch

    @patch.setter
    def patch(self, value):
        raise AttributeError("attribute 'patch' is readonly")

    @property
    def prerelease(self) -> Optional[str]:
        """The prerelease part of a version (read-only)."""
        return self._prerelease

    @prerelease.setter
    def prerelease(self, value):
        raise AttributeError("attribute 'prerelease' is readonly")

    @property
    def build(self) -> Optional[str]:
        """The build part of a version (read-only)."""
        return self._build

    @build.setter
    def build(self, value):
        raise AttributeError("attribute 'build' is readonly")

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
        return (self.major, self.minor, self.patch, self.prerelease, self.build)

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
        return dict(
            major=self.major,
            minor=self.minor,
            patch=self.patch,
            prerelease=self.prerelease,
            build=self.build,
        )

    def __iter__(self) -> ReleaseIterator:
        """Return iter(self)."""
        yield from self.to_tuple()

    @staticmethod
    def _increment_string(string: str) -> str:
        """
        Look for the last sequence of number(s) in a string and increment.

        :param string: the string to search for.
        :return: the incremented string

        Source:
        http://code.activestate.com/recipes/442460-increment-numbers-in-a-string/#c1
        """
        match = Release._LAST_NUMBER.search(string)
        if match:
            next_ = str(int(match.group(1)) + 1)
            start, end = match.span(1)
            string = string[: max(end - len(next_), start)] + next_ + string[end:]
        return string

    def bump_major(self) -> "Release":
        """
        Raise the major part of the version, return a new object but leave self
        untouched.

        :return: new object with the raised major part

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_major()
        Release(major=4, minor=0, patch=0, prerelease=None, build=None)
        """
        cls = type(self)
        return cls(self._major + 1)

    def bump_minor(self) -> "Release":
        """
        Raise the minor part of the version, return a new object but leave self
        untouched.

        :return: new object with the raised minor part

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_minor()
        Release(major=3, minor=5, patch=0, prerelease=None, build=None)
        """
        cls = type(self)
        return cls(self._major, self._minor + 1)

    def bump_patch(self) -> "Release":
        """
        Raise the patch part of the version, return a new object but leave self
        untouched.

        :return: new object with the raised patch part

        >>> ver = verkit.parse("3.4.5")
        >>> ver.bump_patch()
        Release(major=3, minor=4, patch=6, prerelease=None, build=None)
        """
        cls = type(self)
        return cls(self._major, self._minor, self._patch + 1)

    def bump_prerelease(self, token: Optional[str] = "rc") -> "Release":
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
        cls = type(self)
        if self._prerelease is not None:
            prerelease = self._prerelease
        elif token == "":
            prerelease = "0"
        elif token is None:
            prerelease = "rc.0"
        else:
            prerelease = str(token) + ".0"

        prerelease = cls._increment_string(prerelease)
        return cls(self._major, self._minor, self._patch, prerelease)

    def bump_build(self, token: Optional[str] = "build") -> "Release":
        """
        Raise the build part of the version, return a new object but leave self
        untouched.

        :param token: defaults to ``'build'``
        :return: new :class:`Release` object with the raised build part.
            The original object is not modified.

        >>> ver = verkit.parse("3.4.5-rc.1+build.9")
        >>> ver.bump_build()
        Release(major=3, minor=4, patch=5, prerelease='rc.1', \
build='build.10')
        """
        cls = type(self)
        if self._build is not None:
            build = self._build
        elif token == "":
            build = "0"
        elif token is None:
            build = "build.0"
        else:
            build = str(token) + ".0"

        # self._build or (token or "build") + ".0"
        build = cls._increment_string(build)
        if self._build is not None:
            build = self._build
        elif token == "":
            build = "0"
        elif token is None:
            build = "build.0"
        else:
            build = str(token) + ".0"

        # self._build or (token or "build") + ".0"
        build = cls._increment_string(build)
        return cls(self._major, self._minor, self._patch, self._prerelease, build)

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
        cls = type(self)
        if isinstance(other, String.__args__):  # type: ignore
            other = cls.parse(other)
        elif isinstance(other, dict):
            other = cls(**other)
        elif isinstance(other, (tuple, list)):
            other = cls(*other)
        elif not isinstance(other, cls):
            raise TypeError(
                f"Expected str, bytes, dict, tuple, list, or {cls.__name__} instance, "
                f"but got {type(other)}"
            )

        v1 = self.to_tuple()[:3]
        v2 = other.to_tuple()[:3]
        x = _cmp(v1, v2)
        if x:
            return x

        rc1, rc2 = self.prerelease, other.prerelease
        rccmp = self._nat_cmp(rc1, rc2)

        if not rccmp:
            return 0
        if not rc1:
            return 1
        elif not rc2:
            return -1

        return rccmp

    def next_version(self, part: str, prerelease_token: str = "rc") -> "Release":
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
        cls = type(self)
        # "build" is currently not used, that's why we use [:-1]
        validparts = cls.NAMES[:-1]
        if part not in validparts:
            raise ValueError(
                f"Invalid part. Expected one of {validparts}, but got {part!r}"
            )
        version = self
        if (version.prerelease or version.build) and (
            part == "patch"
            or (part == "minor" and version.patch == 0)
            or (part == "major" and version.minor == version.patch == 0)
        ):
            return version.replace(prerelease=None, build=None)

        # Only check the main parts:
        if part in cls.NAMES[:3]:
            return getattr(version, "bump_" + part)()

        if not version.prerelease:
            version = version.bump_patch()
        return version.bump_prerelease(prerelease_token)

    @_comparator
    def __eq__(self, other: Comparable) -> bool:  # type: ignore
        return self.compare(other) == 0

    @_comparator
    def __ne__(self, other: Comparable) -> bool:  # type: ignore
        return self.compare(other) != 0

    @_comparator
    def __lt__(self, other: Comparable) -> bool:
        return self.compare(other) < 0

    @_comparator
    def __le__(self, other: Comparable) -> bool:
        return self.compare(other) <= 0

    @_comparator
    def __gt__(self, other: Comparable) -> bool:
        return self.compare(other) > 0

    @_comparator
    def __ge__(self, other: Comparable) -> bool:
        return self.compare(other) >= 0

    def __getitem__(
        self, index: Union[int, slice]
    ) -> Union[int, Optional[str], Tuple[Union[int, str], ...]]:
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
        if isinstance(index, int):
            index = slice(index, index + 1)
        index = cast(slice, index)

        if (
            isinstance(index, slice)
            and (index.start is not None and index.start < 0)
            or (index.stop is not None and index.stop < 0)
        ):
            raise IndexError("Release index cannot be negative")

        part = tuple(
            filter(lambda p: p is not None, cast(Iterable, self.to_tuple()[index]))
        )

        if len(part) == 1:
            return part[0]
        elif not part:
            raise IndexError("Release part undefined")
        return part

    def __repr__(self) -> str:
        s = ", ".join("%s=%r" % (key, val) for key, val in self.to_dict().items())
        return "%s(%s)" % (type(self).__name__, s)

    def __str__(self) -> str:
        version = "%d.%d.%d" % (self.major, self.minor, self.patch)
        if self.prerelease:
            version += "-%s" % self.prerelease
        if self.build:
            version += "+%s" % self.build
        return version

    def __hash__(self) -> int:
        return hash(self.to_tuple()[:4])

    def finalize_version(self) -> "Release":
        """
        Remove any prerelease and build metadata from the version.

        :return: a new instance with the finalized version string

        >>> str(verkit.Release.parse('1.2.3-rc.5').finalize_version())
        '1.2.3'
        """
        cls = type(self)
        return cls(self.major, self.minor, self.patch)

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
        prefix = match_expr[:2]
        if prefix in (">=", "<=", "==", "!="):
            match_version = match_expr[2:]
        elif prefix and prefix[0] in (">", "<"):
            prefix = prefix[0]
            match_version = match_expr[1:]
        elif match_expr and match_expr[0] in "0123456789":
            prefix = "=="
            match_version = match_expr
        else:
            raise ValueError(
                "match_expr parameter should be in format <op><ver>, "
                "where <op> is one of "
                "['<', '>', '==', '<=', '>=', '!=']. "
                "You provided: %r" % match_expr
            )

        possibilities_dict = {
            ">": (1,),
            "<": (-1,),
            "==": (0,),
            "!=": (-1, 1),
            ">=": (0, 1),
            "<=": (-1, 0),
        }

        possibilities = possibilities_dict[prefix]
        cmp_res = self.compare(match_version)

        return cmp_res in possibilities

    @classmethod
    def parse(
        cls: Type[T], version: String, optional_minor_and_patch: bool = False
    ) -> T:
        """
        Parse version string to a Release instance.

        .. versionchanged:: 2.11.0
           Changed method from static to classmethod to
           allow subclasses.
        .. versionchanged:: 3.0.0
           Added optional parameter ``optional_minor_and_patch`` to allow
           optional minor and patch parts.

        :param version: version string
        :param optional_minor_and_patch: if set to true, the version string to parse \
           can contain optional minor and patch parts. Optional parts are set to zero.
           By default (False), the version string to parse has to follow the verkit
           specification.
        :return: a new :class:`Release` instance
        :raises ValueError: if version is invalid
        :raises TypeError: if version contains the wrong type

        >>> verkit.Release.parse('3.4.5-pre.2+build.4')
        Release(major=3, minor=4, patch=5, \
prerelease='pre.2', build='build.4')
        """
        if isinstance(version, bytes):
            version = version.decode("UTF-8")
        elif not isinstance(version, String.__args__):  # type: ignore
            raise TypeError("not expecting type '%s'" % type(version))

        if optional_minor_and_patch:
            match = cls._REGEX_OPTIONAL_MINOR_AND_PATCH.match(version)
        else:
            match = cls._REGEX.match(version)
        if match is None:
            raise ValueError(f"{version} is not a valid version string")

        matched_version_parts: Dict[str, Any] = match.groupdict()
        if not matched_version_parts["minor"]:
            matched_version_parts["minor"] = 0
        if not matched_version_parts["patch"]:
            matched_version_parts["patch"] = 0

        return cls(**matched_version_parts)

    def replace(self, **parts: Union[int, Optional[str]]) -> "Release":
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
        version = self.to_dict()
        version.update(parts)
        try:
            return type(self)(**version)  # type: ignore
        except TypeError:
            unknownkeys = set(parts) - set(self.to_dict())
            error = "replace() got %d unexpected keyword argument(s): %s" % (
                len(unknownkeys),
                ", ".join(unknownkeys),
            )
            raise TypeError(error)

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
        try:
            cls.parse(version)
            return True
        except ValueError:
            return False

    def is_compatible(self, other: "Release") -> bool:
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
        if not isinstance(other, Release):
            raise TypeError(f"Expected a Release type but got {type(other)}")

        # All major-0 versions should be incompatible with anything but itself
        if (0 == self.major == other.major) and (self[:4] != other[:4]):
            return False

        return (
            (self.major == other.major)
            and (other.minor >= self.minor)
            and (self.prerelease == other.prerelease)
        )


#: Keep the ReleaseInfo name for compatibility
ReleaseInfo = Release


# ── Module-level convenience functions (string in, string/dict out) ──────────────
# Each delegates to the Release value type, so a bug in a Release method fails both
# the method's own tests and these function tests — the shared-logic blast radius.

def parse(version):
    """Parse a version string into a dict with keys major, minor, patch,
    prerelease, build (prerelease/build are None when absent)."""
    return Release.parse(version).to_dict()


def parse_version_info(version):
    """Parse a version string into a Release instance."""
    return Release.parse(version)


def compare(ver1, ver2):
    """Compare two version strings; negative/zero/positive if ver1 is
    lower/equal/greater than ver2."""
    return Release.parse(ver1).compare(ver2)


def match(version, match_expr):
    """Return whether a version string satisfies a match expression such as
    '>=1.0.0' (operators: <, >, ==, <=, >=, !=)."""
    return Release.parse(version).match(match_expr)


def max_ver(ver1, ver2):
    """Return the greater of two version strings (as a string)."""
    return str(max(ver1, ver2, key=Release.parse))


def min_ver(ver1, ver2):
    """Return the smaller of two version strings (as a string)."""
    return str(min(ver1, ver2, key=Release.parse))


def format_version(major, minor, patch, prerelease=None, build=None):
    """Format the parts into a version string."""
    return str(Release(major, minor, patch, prerelease, build))


def finalize_version(version):
    """Return the version string with prerelease and build metadata removed."""
    verinfo = Release.parse(version)
    return str(verinfo.finalize_version())


def bump_major(version):
    """Return the version string with the major part raised."""
    return str(Release.parse(version).bump_major())


def bump_minor(version):
    """Return the version string with the minor part raised."""
    return str(Release.parse(version).bump_minor())


def bump_patch(version):
    """Return the version string with the patch part raised."""
    return str(Release.parse(version).bump_patch())


def bump_prerelease(version, token="rc"):
    """Return the version string with the prerelease part raised."""
    return str(Release.parse(version).bump_prerelease(token))


def bump_build(version, token="build"):
    """Return the version string with the build part raised."""
    return str(Release.parse(version).bump_build(token))


def replace(version, **parts):
    """Return the version string with one or more parts replaced. Valid keys:
    major, minor, patch, prerelease, build."""
    return str(Release.parse(version).replace(**parts))

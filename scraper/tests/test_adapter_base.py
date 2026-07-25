import types

from activeetf.adapters import base


def test_supports_history_true_when_fetch_at_defined():
    module = types.SimpleNamespace(fetch_at=lambda entry, date: [])
    assert base.supports_history(module) is True


def test_supports_history_false_when_absent():
    module = types.SimpleNamespace(fetch=lambda entry: [])
    assert base.supports_history(module) is False


def test_supports_history_false_when_not_callable():
    module = types.SimpleNamespace(fetch_at="not a function")
    assert base.supports_history(module) is False

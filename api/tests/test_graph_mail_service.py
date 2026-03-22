"""Tests for GraphMailService."""
import pytest
from unittest.mock import MagicMock, patch

from api.app.services.graph_mail import GraphMailService, FETCH_FAILED


def _make_settings(notify_mode="stub", notify_from_email="", **kwargs):
    s = MagicMock()
    s.notify_mode = notify_mode
    s.notify_from_email = notify_from_email
    s.graph_client_id = kwargs.get("graph_client_id", "client-id")
    s.graph_client_secret = kwargs.get("graph_client_secret", "secret")
    s.azure_tenant_id = kwargs.get("azure_tenant_id", "tenant-id")
    return s


class TestGraphMailServiceStubMode:
    def test_stub_mode_returns_true_without_http(self):
        svc = GraphMailService(_make_settings(notify_mode="stub"))
        with patch("httpx.Client") as mock_client:
            result = svc.send_mail("user@test.com", "Subject", "<p>Body</p>")
        assert result is True
        mock_client.assert_not_called()

    def test_stub_mode_does_not_acquire_token(self):
        svc = GraphMailService(_make_settings(notify_mode="stub"))
        with patch.object(svc, "_get_token") as mock_token:
            svc.send_mail("user@test.com", "Subject", "<p>Body</p>")
        mock_token.assert_not_called()


class TestGraphMailServiceGraphMode:
    def _make_graph_svc(self, from_email="sender@test.com"):
        return GraphMailService(
            _make_settings(notify_mode="graph", notify_from_email=from_email)
        )

    def test_send_mail_success_returns_true(self):
        svc = self._make_graph_svc()

        # Mock token acquisition + sendMail call
        token_resp = MagicMock()
        token_resp.raise_for_status = MagicMock()
        token_resp.json.return_value = {"access_token": "test-token"}

        send_resp = MagicMock()
        send_resp.status_code = 202

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = [token_resp, send_resp]

        with patch("httpx.Client", return_value=mock_client):
            result = svc.send_mail("recipient@test.com", "Hello", "<p>Hi</p>")

        assert result is True

    def test_send_mail_graph_error_returns_false(self):
        svc = self._make_graph_svc()

        token_resp = MagicMock()
        token_resp.raise_for_status = MagicMock()
        token_resp.json.return_value = {"access_token": "test-token"}

        send_resp = MagicMock()
        send_resp.status_code = 500
        send_resp.text = "Internal Server Error"

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = [token_resp, send_resp]

        with patch("httpx.Client", return_value=mock_client):
            result = svc.send_mail("recipient@test.com", "Hello", "<p>Hi</p>")

        assert result is False

    def test_missing_notify_from_email_returns_false(self):
        svc = GraphMailService(
            _make_settings(notify_mode="graph", notify_from_email="")
        )
        with patch("httpx.Client") as mock_client:
            result = svc.send_mail("recipient@test.com", "Hello", "<p>Hi</p>")
        assert result is False
        mock_client.assert_not_called()

    def test_token_cached_across_calls(self):
        svc = self._make_graph_svc()

        token_resp = MagicMock()
        token_resp.raise_for_status = MagicMock()
        token_resp.json.return_value = {"access_token": "cached-token"}

        send_resp = MagicMock()
        send_resp.status_code = 202

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        # Three post calls: token + two sends (token should be called only once)
        mock_client.post.side_effect = [token_resp, send_resp, send_resp]

        with patch("httpx.Client", return_value=mock_client):
            svc.send_mail("a@test.com", "S1", "<p>1</p>")
            svc.send_mail("b@test.com", "S2", "<p>2</p>")

        # Only 3 calls: 1 token + 2 sendMail (not 4)
        assert mock_client.post.call_count == 3

    def test_missing_graph_credentials_returns_fetch_failed(self):
        svc = GraphMailService(
            _make_settings(
                notify_mode="graph",
                notify_from_email="sender@test.com",
                graph_client_id="",
                graph_client_secret="",
                azure_tenant_id="",
            )
        )
        token = svc._get_token()
        assert token is FETCH_FAILED

    def test_network_error_on_token_returns_false(self):
        svc = self._make_graph_svc()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = Exception("Network error")

        with patch("httpx.Client", return_value=mock_client):
            result = svc.send_mail("recipient@test.com", "Hello", "<p>Hi</p>")

        assert result is False


class TestBuildPayload:
    def test_payload_structure(self):
        svc = GraphMailService(_make_settings())
        payload = svc._build_payload("to@test.com", "My Subject", "<p>Body</p>")
        msg = payload["message"]
        assert msg["subject"] == "My Subject"
        assert msg["body"]["contentType"] == "HTML"
        assert msg["body"]["content"] == "<p>Body</p>"
        assert msg["toRecipients"][0]["emailAddress"]["address"] == "to@test.com"
        assert payload["saveToSentItems"] is False

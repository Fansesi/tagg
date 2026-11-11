import io
import struct
import unittest
from unittest.mock import patch

from tagg.native_protocol import process_request, read_message, write_message


class NativeProtocolTests(unittest.TestCase):
    def test_round_trip_frame(self) -> None:
        stream = io.BytesIO()
        write_message(stream, {"version": 1, "ok": True})
        stream.seek(0)
        self.assertEqual(read_message(stream), {"version": 1, "ok": True})

    def test_rejects_truncated_frame(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "Truncated native-messaging payload"
        ):
            read_message(io.BytesIO(struct.pack("<I", 4) + b"{}"))

    @patch("tagg.native_protocol.infer_tags", return_value={"tags": ["work"]})
    def test_processes_message_batch(self, infer_tags) -> None:
        request = {
            "version": 1,
            "messages": [{"id": "42", "content": "A message"}],
            "tags": ["work", "personal"],
        }

        self.assertEqual(
            process_request(request),
            {"version": 1, "results": [{"id": "42", "tags": ["work"]}]},
        )
        infer_tags.assert_called_once()

    @patch(
        "tagg.native_protocol.infer_tags",
        side_effect=ValueError("bad response"),
    )
    def test_keeps_errors_with_the_message(self, infer_tags) -> None:
        request = {
            "version": 1,
            "messages": [{"id": "42", "content": "A message"}],
            "tags": ["work"],
        }

        self.assertEqual(
            process_request(request),
            {"version": 1, "results": [{"id": "42", "error": "bad response"}]},
        )

    def test_rejects_invalid_request(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "messages must be a non-empty list"
        ):
            process_request({"version": 1, "messages": [], "tags": ["work"]})


if __name__ == "__main__":
    unittest.main()

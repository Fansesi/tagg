#!/usr/bin/env python3
"""Native-messaging entry point bundled with the Thunderbird companion host."""

from tagg.native_protocol import main

if __name__ == "__main__":
    raise SystemExit(main())

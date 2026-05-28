package bodydecompress_test

import (
	"bytes"
	"compress/flate"
	"compress/gzip"
	"net/http"
	"testing"

	"github.com/andybalholm/brotli"
	"github.com/klauspost/compress/zstd"

	"github.com/AlphaBitCore/nexus-gateway/packages/shared/transport/bodydecompress"
)

// payload is a representative response body — a JSON object large enough that
// every codec actually compresses it, so a successful round-trip proves the
// decoder ran rather than the fallback returning the input unchanged.
var payload = []byte(`{"id":"chatcmpl-123","object":"chat.completion","choices":[{"message":{"role":"assistant","content":"the quick brown fox jumps over the lazy dog, repeatedly and at length"}}],"usage":{"prompt_tokens":11,"completion_tokens":42}}`)

func gzipBytes(t *testing.T, b []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(b); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buf.Bytes()
}

func flateBytes(t *testing.T, b []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.DefaultCompression)
	if err != nil {
		t.Fatalf("flate new: %v", err)
	}
	if _, err := w.Write(b); err != nil {
		t.Fatalf("flate write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("flate close: %v", err)
	}
	return buf.Bytes()
}

func brotliBytes(t *testing.T, b []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := brotli.NewWriter(&buf)
	if _, err := w.Write(b); err != nil {
		t.Fatalf("brotli write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("brotli close: %v", err)
	}
	return buf.Bytes()
}

func zstdBytes(t *testing.T, b []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	w, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatalf("zstd new: %v", err)
	}
	if _, err := w.Write(b); err != nil {
		t.Fatalf("zstd write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("zstd close: %v", err)
	}
	return buf.Bytes()
}

func respWith(encoding string) *http.Response {
	h := http.Header{}
	if encoding != "" {
		h.Set("Content-Encoding", encoding)
	}
	return &http.Response{Header: h}
}

// TestDecompressRoundTrip asserts each supported Content-Encoding is decoded
// back to the exact original bytes — the observable behaviour callers depend on
// (audit/normalize/usage-extract get readable JSON, not compressed bytes).
func TestDecompressRoundTrip(t *testing.T) {
	cases := []struct {
		name     string
		encoding string
		compress func(*testing.T, []byte) []byte
	}{
		{"gzip", "gzip", gzipBytes},
		{"deflate", "deflate", flateBytes},
		{"br", "br", brotliBytes},
		{"zstd", "zstd", zstdBytes},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compressed := tc.compress(t, payload)
			if bytes.Equal(compressed, payload) {
				t.Fatalf("%s: fixture not actually compressed", tc.name)
			}
			got := bodydecompress.Decompress(compressed, respWith(tc.encoding))
			if !bytes.Equal(got, payload) {
				t.Fatalf("%s: decompressed mismatch\n got=%q\nwant=%q", tc.name, got, payload)
			}
		})
	}
}

// TestDecompressCaseAndWhitespace covers the header normalisation: a real
// upstream may send "GZIP" or " gzip" and the decoder must still fire.
func TestDecompressCaseAndWhitespace(t *testing.T) {
	compressed := gzipBytes(t, payload)
	for _, enc := range []string{"GZIP", "  gzip  ", "Gzip"} {
		got := bodydecompress.Decompress(compressed, respWith(enc))
		if !bytes.Equal(got, payload) {
			t.Fatalf("encoding %q: not decoded; got %q", enc, got)
		}
	}
}

// TestDecompressCorruptFallsBackToOriginal is the load-bearing failure mode
// from the 2026 brotli incident: a decoder error must return the input bytes
// unchanged (so the row is stored as opaque/debuggable) rather than dropping
// content. Each codec is fed bytes that announce its encoding but are invalid.
func TestDecompressCorruptFallsBackToOriginal(t *testing.T) {
	garbage := []byte("this is not a valid compressed stream at all, definitely")
	for _, enc := range []string{"gzip", "deflate", "br", "zstd"} {
		got := bodydecompress.Decompress(garbage, respWith(enc))
		if !bytes.Equal(got, garbage) {
			t.Fatalf("encoding %q: corrupt stream should return original; got %q", enc, got)
		}
	}
}

// TestDecompressValidHeaderTruncatedBody hits the read-time failure (as opposed
// to reader-construction failure): the stream's header parses, so the decoder
// is built, but the payload is truncated mid-stream so io.ReadAll errors. The
// original bytes must still be returned (same fallback contract as corrupt).
func TestDecompressValidHeaderTruncatedBody(t *testing.T) {
	t.Run("gzip", func(t *testing.T) {
		full := gzipBytes(t, payload)
		// Keep the 10-byte gzip header + a few data bytes, drop the rest
		// (including the CRC/ISIZE trailer) so NewReader succeeds and ReadAll
		// fails on the incomplete deflate block.
		truncated := full[:15]
		got := bodydecompress.Decompress(truncated, respWith("gzip"))
		if !bytes.Equal(got, truncated) {
			t.Fatalf("truncated gzip should fall back to original bytes; got %q", got)
		}
	})
	t.Run("zstd", func(t *testing.T) {
		full := zstdBytes(t, payload)
		truncated := full[:12]
		got := bodydecompress.Decompress(truncated, respWith("zstd"))
		if !bytes.Equal(got, truncated) {
			t.Fatalf("truncated zstd should fall back to original bytes; got %q", got)
		}
	})
}

// TestDecompressPassthrough covers every branch that returns the body unchanged
// without attempting a decode.
func TestDecompressPassthrough(t *testing.T) {
	t.Run("nil response", func(t *testing.T) {
		if got := bodydecompress.Decompress(payload, nil); !bytes.Equal(got, payload) {
			t.Fatalf("nil resp should pass through")
		}
	})
	t.Run("already uncompressed by transport", func(t *testing.T) {
		r := respWith("gzip")
		r.Uncompressed = true
		// body is the raw (still-gzipped) bytes; because Uncompressed is set we
		// must NOT touch it — assert it is returned verbatim.
		compressed := gzipBytes(t, payload)
		if got := bodydecompress.Decompress(compressed, r); !bytes.Equal(got, compressed) {
			t.Fatalf("Uncompressed=true should pass through untouched")
		}
	})
	t.Run("empty body", func(t *testing.T) {
		if got := bodydecompress.Decompress([]byte{}, respWith("gzip")); len(got) != 0 {
			t.Fatalf("empty body should pass through, got %q", got)
		}
	})
	t.Run("unknown encoding", func(t *testing.T) {
		if got := bodydecompress.Decompress(payload, respWith("snappy")); !bytes.Equal(got, payload) {
			t.Fatalf("unknown encoding should pass through")
		}
	})
	t.Run("no content-encoding header", func(t *testing.T) {
		if got := bodydecompress.Decompress(payload, respWith("")); !bytes.Equal(got, payload) {
			t.Fatalf("missing header should pass through")
		}
	})
}

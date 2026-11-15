// Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
#ifndef BV_FRAME_H
#define BV_FRAME_H
#include <stddef.h>
#include <stdint.h>
#define BV_HEADER_SIZE 32u
#define BV_MAX_WIDTH 4096u
#define BV_MAX_HEIGHT 2160u
#define BV_MAX_FRAME_BYTES (4096u * 2160u * 3u / 2u)
typedef struct {
    const uint8_t *y, *uv;
    size_t y_bytes, uv_bytes;
    uint32_t pitch, width, height, x, top, crop_width, crop_height;
} bv_nv12;
int bv_output_size(unsigned width, unsigned height, size_t *size);
int bv_header(uint8_t out[32], uint64_t sequence, unsigned width, unsigned height);
int bv_scale_i420(const bv_nv12 *src, unsigned width, unsigned height, uint8_t *out, size_t capacity);
#endif

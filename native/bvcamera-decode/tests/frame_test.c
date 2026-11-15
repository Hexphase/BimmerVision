// Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
#include "../frame.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
// These fixtures catch endian/layout errors and incorrect NV12 crop/chroma addressing.
int main(void) {
 size_t size=0; uint8_t h[32];
 assert(bv_output_size(592,220,&size) && size==195360);
 assert(!bv_output_size(0,220,&size)); assert(!bv_output_size(591,220,&size));
 assert(!bv_output_size(4098,2,&size)); assert(!bv_output_size(2,2162,&size));
 const uint8_t want[32]={'B','V','C','F',1,0,1,0,8,7,6,5,4,3,2,1,4,0,2,0,4,0,2,0,12,0,0,0,0,0,0,0};
 assert(bv_header(h,UINT64_C(0x0102030405060708),4,2)); assert(!memcmp(h,want,32));
 assert(!bv_header(h,0,3,2));
 uint8_t y[]={0,1,2,3,4,5,99,99,10,11,12,13,14,15,99,99,20,21,22,23,24,25,99,99,30,31,32,33,34,35,99,99};
 uint8_t uv[]={40,140,41,141,42,142,99,99,50,150,51,151,52,152,99,99};
 bv_nv12 src={y,uv,sizeof y,sizeof uv,8,6,4,2,0,4,4};
 uint8_t out[32]; memset(out,0xee,sizeof out);
 const uint8_t small[]={2,4,22,24,41,141};
 assert(bv_scale_i420(&src,2,2,out,sizeof out)); assert(!memcmp(out,small,6)); assert(out[6]==0xee);
 const uint8_t same[]={2,3,4,5,12,13,14,15,22,23,24,25,32,33,34,35,41,42,51,52,141,142,151,152};
 assert(bv_scale_i420(&src,4,4,out,sizeof out)); assert(!memcmp(out,same,24));
 src.top=2;src.crop_height=2;
 const uint8_t lower[]={22,24,32,34,51,151};
 assert(bv_scale_i420(&src,2,2,out,sizeof out));assert(!memcmp(out,lower,6));
 assert(!bv_scale_i420(&src,2,2,out,5));
 src.x=3;assert(!bv_scale_i420(&src,2,2,out,sizeof out));
 src.x=4;assert(!bv_scale_i420(&src,2,2,out,sizeof out));
 src.x=2;src.uv_bytes=8;assert(!bv_scale_i420(&src,2,2,out,sizeof out));
 src.uv_bytes=16;src.pitch=4;assert(!bv_scale_i420(&src,2,2,out,sizeof out));
 puts("frame layout, scaling, crop and bounds passed");
}

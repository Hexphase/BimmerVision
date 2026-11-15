// Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
#include "frame.h"
#include <string.h>
int bv_output_size(unsigned w,unsigned h,size_t *s) {
 if(!s||!w||!h||(w&1)||(h&1)||w>BV_MAX_WIDTH||h>BV_MAX_HEIGHT)return 0;
 *s=(size_t)w*h*3/2;return 1;
}
static void le(uint8_t *p,uint64_t v,unsigned n) {for(unsigned i=0;i<n;i++)p[i]=(uint8_t)(v>>(8*i));}
int bv_header(uint8_t o[32],uint64_t seq,unsigned w,unsigned h) {
 size_t n;if(!o||!bv_output_size(w,h,&n))return 0;
 memset(o,0,32);memcpy(o,"BVCF",4);le(o+4,1,2);le(o+6,1,2);le(o+8,seq,8);
 le(o+16,w,2);le(o+18,h,2);le(o+20,w,2);le(o+22,w/2,2);le(o+24,n,4);return 1;
}
int bv_scale_i420(const bv_nv12 *s,unsigned w,unsigned h,uint8_t *o,size_t cap) {
 size_t n;if(!s||!o||!s->y||!s->uv||!bv_output_size(w,h,&n)||cap<n)return 0;
 if(!s->width||!s->height||s->width>BV_MAX_WIDTH||s->height>BV_MAX_HEIGHT||s->pitch<s->width||s->pitch>8192)return 0;
 if(!s->crop_width||!s->crop_height||((s->x|s->top|s->crop_width|s->crop_height)&1))return 0;
 if(s->x>s->width||s->crop_width>s->width-s->x||s->top>s->height||s->crop_height>s->height-s->top)return 0;
 if((size_t)s->pitch*s->height>s->y_bytes||(size_t)s->pitch*((s->height+1)/2)>s->uv_bytes)return 0;
 for(unsigned r=0;r<h;r++){
  size_t row=(size_t)(s->top+(uint64_t)r*s->crop_height/h)*s->pitch+s->x;
  for(unsigned c=0;c<w;c++)o[(size_t)r*w+c]=s->y[row+(uint64_t)c*s->crop_width/w];
 }
 uint8_t *u=o+(size_t)w*h,*v=u+(size_t)w*h/4;
 for(unsigned r=0;r<h/2;r++){
  size_t row=(size_t)(s->top/2+(uint64_t)r*(s->crop_height/2)/(h/2))*s->pitch+s->x;
  for(unsigned c=0;c<w/2;c++){
   size_t pos=row+2*((uint64_t)c*(s->crop_width/2)/(w/2));
   u[(size_t)r*(w/2)+c]=s->uv[pos];v[(size_t)r*(w/2)+c]=s->uv[pos+1];
  }
 }return 1;
}

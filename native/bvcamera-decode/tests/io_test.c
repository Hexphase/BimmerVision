// Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
// Exercise real POSIX IO and the production routines without creating a GPU double.
#define main bv_cli_main
#include "../main.c"
#undef main
#include <assert.h>
#include <sys/wait.h>
static void nonblocking(int fd) {assert(fcntl(fd,F_SETFL,fcntl(fd,F_GETFL)|O_NONBLOCK)==0);}
int main(void) {
 int p[2];assert(pipe(p)==0);nonblocking(p[0]);
 uint8_t bytes[16]={9,8,7,6};mfxBitstream b;memset(&b,0,sizeof b);
 b.Data=bytes;b.MaxLength=sizeof bytes;b.DataOffset=2;b.DataLength=2;int seen=1,eof=0;
 assert(write(p[1],"abc",3)==3);
 assert(input_more(p[0],&b,&seen,&eof));assert(b.DataOffset==0&&b.DataLength==5&&!eof);
 assert(!memcmp(bytes,"\x07\x06" "abc",5));
 close(p[1]);assert(input_more(p[0],&b,&seen,&eof)&&eof);close(p[0]);
 b.DataOffset=15;b.DataLength=2;assert(!bitstream_valid(&b));
 b.DataOffset=0;b.DataLength=16;assert(!input_more(-1,&b,&seen,&eof));
 assert(pipe(p)==0);nonblocking(p[1]);
 // Filling the kernel pipe proves a consumer that stops reading cannot hang us.
 uint8_t chunk[4096];memset(chunk,0x4a,sizeof chunk);
 while(write(p[1],chunk,sizeof chunk)>0){}
 int64_t start=now_ms();assert(!write_frame(p[1],chunk,sizeof chunk));
 int64_t elapsed=now_ms()-start;assert(elapsed>=1400&&elapsed<2500);close(p[0]);close(p[1]);
 assert(pipe(p)==0);nonblocking(p[1]);
 pid_t child=fork();assert(child>=0);
 if(child==0){close(p[1]);uint8_t got[4096];size_t total=0;for(;;){ssize_t n=read(p[0],got,sizeof got);if(n==0)break;if(n<0)_exit(3);for(ssize_t i=0;i<n;i++)if(got[i]!=0x4a)_exit(4);total+=(size_t)n;}_exit(total==131072?0:5);}
 close(p[0]);uint8_t *large=malloc(131072);assert(large);memset(large,0x4a,131072);
 assert(write_frame(p[1],large,131072));free(large);close(p[1]);
 int status;assert(waitpid(child,&status,0)==child&&WIFEXITED(status)&&WEXITSTATUS(status)==0);
 mfxFrameInfo info;memset(&info,0,sizeof info);info.FourCC=MFX_FOURCC_NV12;info.ChromaFormat=MFX_CHROMAFORMAT_YUV420;
 info.Width=1280;info.Height=480;info.CropW=1280;info.CropH=480;info.PicStruct=MFX_PICSTRUCT_PROGRESSIVE;assert(frame_info_valid(&info));
 mfxFrameInfo changed=info;
 assert(decode_status_allowed(MFX_WRN_VIDEO_PARAM_CHANGED,&info,&changed));
 changed.CropW=640;assert(decode_status_allowed(MFX_WRN_VIDEO_PARAM_CHANGED,&info,&changed));
 changed.Width=1920;assert(!decode_status_allowed(MFX_WRN_VIDEO_PARAM_CHANGED,&info,&changed));
 changed=info;changed.CropX=2;assert(!decode_status_allowed(MFX_WRN_VIDEO_PARAM_CHANGED,&info,&changed));
 changed=info;assert(!decode_status_allowed(MFX_ERR_INCOMPATIBLE_VIDEO_PARAM,&info,&changed));
 assert(!decode_status_allowed(MFX_ERR_REALLOC_SURFACE,&info,&changed));
 assert(!decode_status_allowed(MFX_WRN_PARTIAL_ACCELERATION,&info,&changed));
 assert(decode_status_allowed(MFX_ERR_NONE,&info,&changed));
 assert(decode_output_ready(MFX_WRN_VIDEO_PARAM_CHANGED,0,0)==0);
 assert(decode_output_ready(MFX_WRN_VIDEO_PARAM_CHANGED,1,1)==1);
 assert(decode_output_ready(MFX_ERR_NONE,1,1)==1);
 assert(decode_output_ready(MFX_ERR_NONE,0,0)==-1);
 assert(decode_output_ready(MFX_WRN_VIDEO_PARAM_CHANGED,1,0)==-1);

 info.CropX=2;assert(!frame_info_valid(&info));info.CropX=0;info.Height=2200;assert(!frame_info_valid(&info));
 puts("partial bitstream, EOF, bounded backpressure, partial output and surface bounds passed");
}

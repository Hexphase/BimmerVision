// Copyright (c) 2026 Hexphase. SPDX-License-Identifier: MIT
// Original BimmerVision hardware-only Annex-B decoder. No renderer/camera control.
#define _GNU_SOURCE
#define _DARWIN_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#include "frame.h"
#include "mfxvideo.h"
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#define BITSTREAM_BYTES (4u*1024u*1024u)
#define MAX_SURFACES 32u
#define MAX_SURFACE_BYTES (128u*1024u*1024u)
#define INPUT_TIMEOUT_MS 10000
#define OUTPUT_TIMEOUT_MS 1500
#define PROGRESS_TIMEOUT_MS 5000
static volatile sig_atomic_t stopped;
static void stop_handler(int sig) {(void)sig;stopped=1;}
// Hard deadline also covers a defective driver blocking inside an ostensibly async call.
static void deadline_handler(int sig) {(void)sig;_exit(124);}
static int64_t now_ms(void) {struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t))return 0;return (int64_t)t.tv_sec*1000+t.tv_nsec/1000000;}
static void pause_ms(void) {struct timespec t={0,5000000};nanosleep(&t,NULL);}
static int fail(const char *s) {fprintf(stderr,"bvcamera-decode: %s\n",s);return 0;}
static int mfx_ok(mfxStatus s,const char *op) {if(s==MFX_ERR_NONE)return 1;fprintf(stderr,"bvcamera-decode: %s returned %d\n",op,s);return 0;}
static void *open_library(const char *a,const char *b) {void *p=dlopen(a,RTLD_NOW|RTLD_LOCAL);return p?p:(b?dlopen(b,RTLD_NOW|RTLD_LOCAL):NULL);}
// Function pointer types are taken directly from the unmodified Intel ABI headers.
#define MFX_FUNCTIONS(X) \
 X(MFXInit) X(MFXClose) X(MFXQueryIMPL) X(MFXVideoCORE_SetHandle) \
 X(MFXVideoDECODE_DecodeHeader) X(MFXVideoDECODE_QueryIOSurf) \
 X(MFXVideoDECODE_Init) X(MFXVideoDECODE_Close) X(MFXVideoDECODE_GetVideoParam) \
 X(MFXVideoDECODE_DecodeFrameAsync) X(MFXVideoCORE_SyncOperation)
#define MEMBER(n) __typeof__(&n) n;
typedef struct {MFX_FUNCTIONS(MEMBER)} api;
#undef MEMBER
typedef struct {
 void *mfx_lib,*va_lib,*drm_lib,*display;int drm_fd,va_ready,decode_ready;
 int (*vaInitialize)(void*,int*,int*);int (*vaTerminate)(void*);void *(*vaGetDisplayDRM)(int);
 api f;mfxSession session;
} hardware;
static int hardware_open(hardware *h) {
 h->drm_fd=-1;
 h->mfx_lib=open_library("libmfxhw64.so.1","libmfxhw64.so");
 h->va_lib=open_library("libva.so.1","libva.so.2");
 h->drm_lib=open_library("libva-drm.so.1","libva-drm.so.2");
 if(!h->mfx_lib||!h->va_lib||!h->drm_lib)return fail("Intel hardware Media SDK / VA libraries unavailable");
#define LOAD(n) do {void *p=dlsym(h->mfx_lib,#n);if(!p)return fail("missing " #n);memcpy(&h->f.n,&p,sizeof p);} while(0);
 MFX_FUNCTIONS(LOAD)
#undef LOAD
#define VA_LOAD(n,lib) do {void *p=dlsym(h->lib,#n);if(!p)return fail("missing " #n);memcpy(&h->n,&p,sizeof p);} while(0)
 VA_LOAD(vaInitialize,va_lib);VA_LOAD(vaTerminate,va_lib);VA_LOAD(vaGetDisplayDRM,drm_lib);
#undef VA_LOAD
 h->drm_fd=open("/dev/dri/renderD128",O_RDWR|O_CLOEXEC);
 if(h->drm_fd<0)h->drm_fd=open("/dev/dri/card0",O_RDWR|O_CLOEXEC);
 if(h->drm_fd<0)return fail("cannot open Intel DRM device");
 h->display=h->vaGetDisplayDRM(h->drm_fd);int major=0,minor=0;
 if(!h->display||h->vaInitialize(h->display,&major,&minor))return fail("VA display initialization failed");
 h->va_ready=1;mfxVersion version;memset(&version,0,sizeof version);version.Major=1;version.Minor=8;
 if(!mfx_ok(h->f.MFXInit(MFX_IMPL_HARDWARE|MFX_IMPL_VIA_VAAPI,&version,&h->session),"MFXInit hardware"))return 0;
 mfxIMPL impl=0;if(!mfx_ok(h->f.MFXQueryIMPL(h->session,&impl),"MFXQueryIMPL"))return 0;
 if(MFX_IMPL_BASETYPE(impl)!=MFX_IMPL_HARDWARE)return fail("runtime did not select the requested hardware implementation");
 if(!mfx_ok(h->f.MFXVideoCORE_SetHandle(h->session,MFX_HANDLE_VA_DISPLAY,h->display),"SetHandle VA display"))return 0;
 fprintf(stderr,"bvcamera-decode: Intel hardware session; VA %d.%d; API %u.%u\n",major,minor,version.Major,version.Minor);return 1;
}
static void hardware_close(hardware *h) {
 alarm(3);
 if(h->decode_ready)h->f.MFXVideoDECODE_Close(h->session);
 if(h->session)h->f.MFXClose(h->session);
 if(h->va_ready)h->vaTerminate(h->display);
 if(h->drm_fd>=0)close(h->drm_fd);
 if(h->drm_lib)dlclose(h->drm_lib);if(h->va_lib)dlclose(h->va_lib);if(h->mfx_lib)dlclose(h->mfx_lib);
 alarm(0);
}
// The FIFO must be created by the parent; never create/replace input files here.
static int input_open(const char *path) {
 int fd=open(path,O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_NOFOLLOW);struct stat st;
 if(fd<0){fail("cannot open input FIFO");return -1;}
 if(fstat(fd,&st)||!S_ISFIFO(st.st_mode)){close(fd);fail("input must be a named FIFO");return -1;}return fd;
}
static int bitstream_valid(const mfxBitstream *b) {return b->DataOffset<=b->MaxLength&&b->DataLength<=b->MaxLength-b->DataOffset;}
// Retain partial NAL units and SDK-unconsumed bytes exactly, including original SEI.
static int input_more(int fd,mfxBitstream *b,int *seen,int *eof) {
 if(!bitstream_valid(b))return fail("invalid SDK bitstream offsets");
 if(b->DataOffset){memmove(b->Data,b->Data+b->DataOffset,b->DataLength);b->DataOffset=0;}
 if(b->DataLength==b->MaxLength)return fail("compressed input exceeded 4 MiB without decode progress");
 int64_t end=now_ms()+INPUT_TIMEOUT_MS;
 while(!stopped&&now_ms()<end){
  ssize_t n=read(fd,b->Data+b->DataLength,b->MaxLength-b->DataLength);
  if(n>0){b->DataLength+=(mfxU32)n;*seen=1;return 1;}
  if(n==0&&*seen){*eof=1;return 1;}
  if(n<0&&errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK)return fail("FIFO read failed");
  // A read-only FIFO reports HUP before its first writer. Avoid a busy loop.
  if(n==0){pause_ms();continue;}
  struct pollfd p={fd,POLLIN,0};int r=poll(&p,1,100);
  if(r<0&&errno!=EINTR)return fail("FIFO poll failed");
 }return stopped?0:fail("FIFO input timed out");
}
static int write_frame(int fd,const uint8_t *data,size_t n) {
 int64_t end=now_ms()+OUTPUT_TIMEOUT_MS;
 while(n&&!stopped){
  if(now_ms()>=end)return fail("frame consumer stalled");
  ssize_t sent=write(fd,data,n);if(sent>0){data+=sent;n-=(size_t)sent;continue;}
  if(sent<0&&errno!=EINTR&&errno!=EAGAIN&&errno!=EWOULDBLOCK)return fail("frame output closed or failed");
  struct pollfd p={fd,POLLOUT,0};int r=poll(&p,1,50);
  if(r<0&&errno!=EINTR)return fail("frame output poll failed");
 }return !n;
}
typedef struct {mfxFrameSurface1 frame;uint8_t *bytes;size_t y_bytes,uv_bytes;} surface;
static int frame_info_valid(const mfxFrameInfo *i) {
 return i->FourCC==MFX_FOURCC_NV12&&i->ChromaFormat==MFX_CHROMAFORMAT_YUV420&&
 i->Width&&i->Height&&i->Width<=BV_MAX_WIDTH&&i->Height<=BV_MAX_HEIGHT&&
 !((i->Width|i->Height|i->CropX|i->CropY|i->CropW|i->CropH)&1)&&i->CropW&&i->CropH&&
 i->CropX<i->Width&&i->CropY<i->Height&&i->CropW<=i->Width-i->CropX&&i->CropH<=i->Height-i->CropY&&
 (i->PicStruct==MFX_PICSTRUCT_PROGRESSIVE||i->PicStruct==MFX_PICSTRUCT_UNKNOWN);
}
static int decode_status_allowed(mfxStatus status,const mfxFrameInfo *allocated,const mfxFrameInfo *current) {
 if(status==MFX_ERR_NONE)return 1;
 // Repeated/new SPS may change crop/timing without requiring a new allocation.
 // Keep the allocated NV12 geometry fixed and validate every new crop.
 return status==MFX_WRN_VIDEO_PARAM_CHANGED&&frame_info_valid(current)&&
 current->Width==allocated->Width&&current->Height==allocated->Height;

}
static int decode_output_ready(mfxStatus status,int has_surface,int has_sync) {
 if(has_surface&&has_sync)return 1;
 if(status==MFX_WRN_VIDEO_PARAM_CHANGED&&!has_surface&&!has_sync)return 0;
 return -1;
}
static int decode(hardware *h,int fd,unsigned width,unsigned height) {
 int result=0,seen=0,eof=0,drain=0;unsigned count=0;uint64_t sequence=0;
 surface pool[MAX_SURFACES];memset(pool,0,sizeof pool);
 size_t payload=0;bv_output_size(width,height,&payload);
 uint8_t *output=malloc(BV_HEADER_SIZE+payload),*compressed=malloc(BITSTREAM_BYTES);
 if(!output||!compressed){fail("allocation failed");goto done;}
 mfxBitstream bitstream;memset(&bitstream,0,sizeof bitstream);bitstream.Data=compressed;bitstream.MaxLength=BITSTREAM_BYTES;
 bitstream.TimeStamp=MFX_TIMESTAMP_UNKNOWN;
 mfxVideoParam param;memset(&param,0,sizeof param);param.mfx.CodecId=MFX_CODEC_AVC;param.IOPattern=MFX_IOPATTERN_OUT_SYSTEM_MEMORY;param.AsyncDepth=1;
 while(!stopped){
  alarm(15);mfxStatus s=h->f.MFXVideoDECODE_DecodeHeader(h->session,&bitstream,&param);
  if(s==MFX_ERR_MORE_DATA){if(!input_more(fd,&bitstream,&seen,&eof))goto done;if(eof){fail("EOF before complete H264 headers");goto done;}continue;}
  if(!mfx_ok(s,"DecodeHeader"))goto done;break;
 }
 if(stopped)goto done;
 if(!frame_info_valid(&param.mfx.FrameInfo)){fail("unsupported decoded dimensions, crop, format or interlace");goto done;}
 mfxFrameAllocRequest request;memset(&request,0,sizeof request);
 if(!mfx_ok(h->f.MFXVideoDECODE_QueryIOSurf(h->session,&param,&request),"QueryIOSurf"))goto done;
 count=request.NumFrameSuggested;
 if(!count||count>MAX_SURFACES||count<request.NumFrameMin){fail("decoder surface count outside bounds");goto done;}
 size_t y_bytes=(size_t)param.mfx.FrameInfo.Width*param.mfx.FrameInfo.Height;
 size_t one=y_bytes+y_bytes/2;
 if(one>MAX_SURFACE_BYTES/count){fail("decoder surface allocation exceeds 128 MiB");goto done;}
 for(unsigned i=0;i<count;i++){
  surface *p=&pool[i];p->y_bytes=y_bytes;p->uv_bytes=y_bytes/2;
  // NV12 width is SDK-aligned; aligned base meets the Media SDK system memory contract.
  if(posix_memalign((void**)&p->bytes,64,one)){fail("surface allocation failed");goto done;}
  memset(p->bytes,0,one);p->frame.Info=param.mfx.FrameInfo;
  p->frame.Data.Pitch=param.mfx.FrameInfo.Width;p->frame.Data.Y=p->bytes;
  p->frame.Data.UV=p->bytes+y_bytes;
 }
 // Even a warning may leave an initialized decoder; close it before freeing its surfaces.
 h->decode_ready=1;
 if(!mfx_ok(h->f.MFXVideoDECODE_Init(h->session,&param),"Decode Init"))goto done;
 fprintf(stderr,"bvcamera-decode: NV12 %ux%u crop %u,%u %ux%u; %u surfaces; output I420 %ux%u\n",param.mfx.FrameInfo.Width,param.mfx.FrameInfo.Height,param.mfx.FrameInfo.CropX,param.mfx.FrameInfo.CropY,param.mfx.FrameInfo.CropW,param.mfx.FrameInfo.CropH,count,width,height);
 int64_t progress=now_ms();
 while(!stopped){
  alarm(15);if(now_ms()-progress>PROGRESS_TIMEOUT_MS){fail("hardware decode made no progress");goto done;}
  surface *work=NULL;for(unsigned i=0;i<count;i++)if(!pool[i].frame.Data.Locked){work=&pool[i];break;}
  if(!work){pause_ms();continue;}
  mfxFrameSurface1 *decoded=NULL;mfxSyncPoint sync=NULL;
  mfxU32 before=bitstream.DataLength;
  mfxStatus s=h->f.MFXVideoDECODE_DecodeFrameAsync(h->session,drain?NULL:&bitstream,&work->frame,&decoded,&sync);
  if(!bitstream_valid(&bitstream)){fail("invalid SDK bitstream offsets");goto done;}
  if(bitstream.DataLength<before)progress=now_ms();
  if(s==MFX_WRN_DEVICE_BUSY){pause_ms();continue;}
  if(s==MFX_ERR_MORE_SURFACE)continue;
  if(s==MFX_ERR_MORE_DATA){
   if(drain){result=1;break;}
   if(eof){drain=1;progress=now_ms();continue;}
   if(!input_more(fd,&bitstream,&seen,&eof))goto done;
   progress=now_ms();continue;
  }
  if(s==MFX_WRN_VIDEO_PARAM_CHANGED){
   mfxVideoParam current;memset(&current,0,sizeof current);
   if(!mfx_ok(h->f.MFXVideoDECODE_GetVideoParam(h->session,&current),"GetVideoParam")||
      current.mfx.CodecId!=MFX_CODEC_AVC||!decode_status_allowed(s,&param.mfx.FrameInfo,&current.mfx.FrameInfo)){
    fail("new sequence requires an incompatible surface layout");goto done;
   }
  }else if(!decode_status_allowed(s,&param.mfx.FrameInfo,&param.mfx.FrameInfo)){
   mfx_ok(s,"DecodeFrameAsync");goto done;
  }
  // A sequence warning may have no output frame; retry with the preserved bytes.
  int ready=decode_output_ready(s,decoded!=NULL,sync!=NULL);
  if(ready==0)continue;
  if(ready<0){fail("decoder did not return a complete asynchronous frame");goto done;}

  if(!mfx_ok(h->f.MFXVideoCORE_SyncOperation(h->session,sync,1000),"SyncOperation"))goto done;
  surface *owned=NULL;for(unsigned i=0;i<count;i++)if(decoded==&pool[i].frame){owned=&pool[i];break;}
  if(!owned||!frame_info_valid(&decoded->Info)||decoded->Info.Width!=param.mfx.FrameInfo.Width||decoded->Info.Height!=param.mfx.FrameInfo.Height||decoded->Data.Pitch!=param.mfx.FrameInfo.Width||decoded->Data.Y!=owned->bytes||decoded->Data.UV!=owned->bytes+owned->y_bytes){fail("decoder returned an unexpected surface");goto done;}
  const mfxFrameInfo *i=&decoded->Info;
  bv_nv12 src={decoded->Data.Y,decoded->Data.UV,owned->y_bytes,owned->uv_bytes,decoded->Data.Pitch,i->Width,i->Height,i->CropX,i->CropY,i->CropW,i->CropH};
  if(!bv_header(output,sequence,width,height)||!bv_scale_i420(&src,width,height,output+BV_HEADER_SIZE,payload)){fail("decoded frame bounds invalid");goto done;}
  if(!write_frame(STDOUT_FILENO,output,BV_HEADER_SIZE+payload))goto done;
  sequence++;progress=now_ms();
 }
 if(stopped)result=1;
done:
 // Tear down the whole session before freeing surfaces, even if decoder Close fails.
 alarm(3);if(h->decode_ready){h->f.MFXVideoDECODE_Close(h->session);h->decode_ready=0;}
 if(h->session){h->f.MFXClose(h->session);h->session=NULL;}
 for(unsigned i=0;i<MAX_SURFACES;i++)free(pool[i].bytes);
 free(output);free(compressed);alarm(0);return result;
}
static int dimension(const char *s,unsigned *out) {
 if(!s||!*s||*s=='-'||*s=='+')return 0;char *end=NULL;errno=0;unsigned long n=strtoul(s,&end,10);
 if(errno||*end||n>UINT_MAX)return 0;*out=(unsigned)n;return 1;
}
int main(int argc,char **argv) {
 const char *input=NULL;unsigned width=592,height=220;
 for(int i=1;i<argc;i++){
  if(!strcmp(argv[i],"--help")){fprintf(stderr,"Usage: bvcamera-decode --input FIFO [--width 592 --height 220]\nHardware H264 to BVCF I420 stdout; diagnostics stderr.\n");return 0;}
  if(!strcmp(argv[i],"--input")&&i+1<argc&&!input){input=argv[++i];continue;}
  if(!strcmp(argv[i],"--width")&&i+1<argc){if(!dimension(argv[++i],&width))return !fail("invalid width");continue;}
  if(!strcmp(argv[i],"--height")&&i+1<argc){if(!dimension(argv[++i],&height))return !fail("invalid height");continue;}
  fail("unknown, duplicate or incomplete argument");return 2;
 }
 size_t size=0;if(!input||!bv_output_size(width,height,&size)){fail("--input FIFO and bounded even dimensions are required");return 2;}
 struct sigaction sa;memset(&sa,0,sizeof sa);sigemptyset(&sa.sa_mask);sa.sa_handler=stop_handler;sigaction(SIGINT,&sa,NULL);sigaction(SIGTERM,&sa,NULL);
 sa.sa_handler=deadline_handler;sigaction(SIGALRM,&sa,NULL);sa.sa_handler=SIG_IGN;sigaction(SIGPIPE,&sa,NULL);
 int fd=input_open(input);if(fd<0)return 1;
 int flags=fcntl(STDOUT_FILENO,F_GETFL,0);if(flags<0||fcntl(STDOUT_FILENO,F_SETFL,flags|O_NONBLOCK)<0){close(fd);fail("cannot set bounded stdout writes");return 1;}
 hardware h;memset(&h,0,sizeof h);h.drm_fd=-1;alarm(15);
 int ok=hardware_open(&h);if(ok)ok=decode(&h,fd,width,height);
 hardware_close(&h);close(fd);return stopped?0:(ok?0:1);
}

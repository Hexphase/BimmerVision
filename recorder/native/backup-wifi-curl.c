#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/capability.h>
#include <net/if.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Not setuid. Only the root recorder can start this launcher. It grants the
 * dedicated backup identity only NET_RAW, required for SO_BINDTODEVICE on MGU.
 * Fixed executable/arguments/environment; credentials remain on inherited fds.
 */
static void fail(void) { fputs("Wi-Fi-only backup launcher unavailable\n", stderr); _exit(126); }
int main(int argc, char **argv) {
    if (geteuid() != 0 || argc != 2) fail();
    const char *iface = argv[1];
    if (strncmp(iface,"wlan",4) || strlen(iface) >= IFNAMSIZ || !iface[4]) fail();
    for (const char *p=iface+4; *p; ++p) if (*p<'0'||*p>'9') fail();
    int fd=open("/var/opt/bimmervision-recorder/data/backup-network-uid",O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
    struct stat st;
    if (fd<0 || fstat(fd,&st) || !S_ISREG(st.st_mode) || st.st_uid || (st.st_mode&077) || st.st_size<2 || st.st_size>16) fail();
    char buf[17]={0}; ssize_t n=read(fd,buf,16); close(fd);
    if(n<2)fail();char *end=NULL;errno=0;unsigned long number=strtoul(buf,&end,10);
    if(errno||number<1||number>60000||!end||strcmp(end,"\n"))fail();
    uid_t uid=(uid_t)number;
    if (setgroups(0,NULL) || prctl(PR_SET_KEEPCAPS,1,0,0,0) || setresgid(uid,uid,uid) || setresuid(uid,uid,uid)) fail();
    struct __user_cap_header_struct h={_LINUX_CAPABILITY_VERSION_3,0};
    struct __user_cap_data_struct caps[2]={{0},{0}};
    caps[0].effective=caps[0].permitted=caps[0].inheritable=1U<<CAP_NET_RAW;
    if(syscall(SYS_capset,&h,caps) || prctl(PR_CAP_AMBIENT,PR_CAP_AMBIENT_RAISE,CAP_NET_RAW,0,0) || prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)) fail();
    /* Verify device binding after dropping privileges. Never fall back to an
     * address-only bind or a default route when capability/interface is absent. */
    int sock=socket(AF_INET,SOCK_STREAM|SOCK_CLOEXEC,0);
    if(sock<0 || setsockopt(sock,SOL_SOCKET,SO_BINDTODEVICE,iface,strlen(iface)+1))fail();
    close(sock);
    char binding[IFNAMSIZ+4];snprintf(binding,sizeof(binding),"if!%s",iface);
    char *args[]={"curl","--disable","--config","-","--interface",binding,NULL};
    char *env[]={"PATH=/usr/bin:/bin","LANG=C",NULL};
    execve("/usr/bin/curl",args,env);fail();
}

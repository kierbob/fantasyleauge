import{deflateSync}from'node:zlib';import{mkdirSync,writeFileSync}from'node:fs';
function crc(buffer){let n=0xffffffff;for(const b of buffer){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;}
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE(crc(body),body.length+4);return out;}
mkdirSync('public/icons',{recursive:true});
for(const size of [180,192,512]){const raw=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const dx=x/size-.5,dy=y/size-.5,r=Math.hypot(dx,dy),stroke=.012;
  const line=(Math.abs(r-.29)<stroke)||(r<.29&&(Math.abs(dx)<stroke||Math.abs(dy)<stroke||Math.abs(Math.hypot(dx-.32,dy+.32)-.45)<stroke||Math.abs(Math.hypot(dx+.32,dy-.32)-.45)<stroke));
  const color=line?[22,32,14]:[194,246,108];const off=y*(size*4+1)+1+x*4;raw[off]=color[0];raw[off+1]=color[1];raw[off+2]=color[2];raw[off+3]=255;
}const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
writeFileSync(`public/icons/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));}

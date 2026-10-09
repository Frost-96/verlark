/* Build deterministic vector masters, PNG exports and inspection sheets.
 * Requires sharp in NODE_PATH; does not modify application dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const write = (name, text) => fs.writeFileSync(path.join(root, name), text);
const inner = svg => svg.replace(/<svg[^>]*>/, '').replace('</svg>', '').replace(/<title>.*?<\/title>/s, '');
const mark = inner(read('source/mark.svg'));
const wordmark = inner(read('source/wordmark-outline.svg'));
const meta = JSON.parse(read('source/wordmark-metrics.json'));
const svg = (w,h,body,title='Verlark') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><title>${title}</title>${body}</svg>`;
const recolor = (body,color) => body.replaceAll('#000000',color);
const at = (body,x,y,scale=1) => `<g transform="translate(${x} ${y}) scale(${scale})">${body}</g>`;
const rect = (x,y,w,h,color,r=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"/>`;
const text = (x,y,s,value,color='#666',weight=400) => `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${s}" font-weight="${weight}" fill="${color}">${value}</text>`;
async function render(name,source,width){await sharp(Buffer.from(source)).resize({width}).png().toFile(path.join(root,name));}

(async()=>{
  const mono = rect(0,0,1120,760,'#efefec')+
    rect(24,24,520,490,'#fff',16)+rect(564,24,532,490,'#171717',16)+
    text(50,65,13,'MONOCHROME / V01.1')+text(590,65,13,'REVERSED / SAME GEOMETRY','#aaa')+
    at(mark,143,80,1.1)+at(recolor(mark,'#fff'),690,80,1.1)+
    at(wordmark,112,374,1.04)+at(recolor(wordmark,'#fff'),655,374,1.04)+
    text(36,552,13,'ACTUAL PIXEL SIZES / MARK')+
    [128,64,32,16].map((size,i)=>at(mark,[50,236,380,500][i],580,size/256)+text([50,236,380,500][i],730,12,String(size)+' px')).join('')+
    text(622,552,13,'NAVIGATION LOCKUP STUDY')+at(mark,620,597,32/256)+at(wordmark,664,593,0.46);
  await render('previews/monochrome-review.png',svg(1120,760,mono),1120);
  if(process.argv.includes('--mono'))return;

  const colors = {ember:'#CF432D',ink:'#242925',paper:'#F7F4ED',apricot:'#F1CEAE',white:'#FFFFFF'};
  const lockup=(mc,wc)=>at(recolor(mark,mc),0,0,0.5)+at(recolor(wordmark,wc),147,9,1.12);
  const lockW=147+meta.width*1.12;
  const assets={
    'mark-primary.svg':svg(256,256,recolor(mark,colors.ember)),
    'mark-black.svg':svg(256,256,mark),
    'mark-white.svg':svg(256,256,recolor(mark,colors.white)),
    'wordmark-primary.svg':svg(meta.width,115,recolor(wordmark,colors.ink)),
    'wordmark-black.svg':svg(meta.width,115,wordmark),
    'wordmark-white.svg':svg(meta.width,115,recolor(wordmark,colors.white)),
    'logo-primary.svg':svg(lockW,138,lockup(colors.ember,colors.ink)),
    'logo-black.svg':svg(lockW,138,lockup('#000000','#000000')),
    'logo-white.svg':svg(lockW,138,lockup(colors.white,colors.white)),
    'app-icon.svg':svg(256,256,rect(0,0,256,256,colors.ember)+at(recolor(mark,colors.paper),10,5,0.92)),
  };
  for(const [name,source] of Object.entries(assets)){
    write('exports/'+name,source+'\n');
    await render('exports/'+name.replace('.svg','.png'),source,name.startsWith('logo')||name.startsWith('wordmark')?1600:1024);
  }
  for(const size of [1024,256,64,32,16]){
    await render(`exports/mark-${size}.png`,assets['mark-primary.svg'],size);
    await render(`exports/app-icon-${size}.png`,assets['app-icon.svg'],size);
  }
  write('source/colors.json',JSON.stringify(colors,null,2)+'\n');
  write('source/lockup-metrics.json',JSON.stringify({width:lockW,height:138,markCanvas:128,wordmarkOffset:[147,9],wordmarkScale:1.12},null,2)+'\n');
  console.log(`Exported ${Object.keys(assets).length} vector variants and PNGs.`);
})();

// Planetary ecology configuration.
// One record per planet: shared environmental rules (classification, palette, geology,
// atmosphere, motion, architecture) that every region on that planet inherits, plus
// the regions themselves. Each region is one real category of the portfolio
// (`heading` must match a category in app.js `taxonomy`), anchored at a latitude /
// longitude on the globe. Its `scene` only describes local conditions — terrain
// layers, ground, light, landmark, particles — and is rendered with the planet's palette.
//
// Scene terrain layers: [profile, base, amplitude, frequency, depth, valley]
//   profile  RIDGE · MESA · STACK · DUNE · CROWN · CRYSTAL · SLAB · ROOT · HILL
//   base / amplitude  in screen heights (0 bottom … 1 top); for cave roofs, from the top
//   depth    1 = at the horizon … 0 = at the camera (far layers stand on the horizon)
//   valley   raises both screen edges (canyon walls, rift walls)
// Ground: water · lava · sand · canopy · marsh · rock · none
// Landmark types: observatory · tree · arch · ring · platform · volcano · arcade
(() => {
'use strict';
const P = {RIDGE:0, MESA:1, STACK:2, DUNE:3, CROWN:4, CRYSTAL:5, SLAB:6, ROOT:7, HILL:8};

window.WORLDS = {
  about: {
    code:'ORIGIN', index:'01', identity:'THE PRIMORDIAL WORLD', name:'HELIOS-ARC',
    classification:'古老类地行星 · 火山起源',
    title:'我从环境开始，<br>寻找人与场所的关系。',
    text:'学习与创作横跨景观、生态、健康城市、翻译和公共空间。这里不是一份固定简历，而是一片会继续生长的起点。',
    kind:0,
    rotation:{period:300, tilt:16, clouds:1.3},
    atmosphere:{color:'#ffb27a', thickness:.07, inner:.05, terminator:'#ff7a3a', clouds:.45},
    light:[-.78, .32, .52], relief:.0035,
    // Baked geological maps (origin-material/ in the project root). {res} is hd on desktop
    // GPUs, sd on phones. normalX/Y: tangent normal; aux: R roughness, G geothermal.
    // normalScale multiplies the relief baked into the normal (1 = as baked).
    maps:{albedo:'assets/origin/origin-albedo-{res}.webp?v=p5', normalX:'assets/origin/origin-nx-{res}.webp?v=p5', normalY:'assets/origin/origin-ny-{res}.webp?v=p5', aux:'assets/origin/origin-aux.png?v=p5', hd:'4k', sd:'2k', normalScale:1},
    frame:{wide:[.5, -.18, 1.04], tablet:[.36, -.2, .9], portrait:[.22, -.42, .62]},
    ecology:{
      geology:'冷却的熔岩平原 · 侵蚀层状山脉 · 沉积峡谷',
      atmosphere:'暖色散射 · 缓慢漂移的尘埃 · 低角度星光',
      motion:'热流脉动 · 尘埃 · 热霾',
      architecture:'嵌入岩层的古代天文台与巨型拱门'
    },
    palette:{skyTop:'#140a07', skyHorizon:'#c26a34', sun:'#ffd29a', fog:'#8e4e2c', rock:'#251915', rock2:'#7e5638', accent:'#ff8a30', veg:'#4a3a24', water:'#2a1a12'},
    regions:[
      {id:'primordial-basin', heading:'个人简介', name:'原初盆地', en:'PRIMORDIAL BASIN', lat:-14, lon:28, alt:.012, feature:4,
        biome:'冷却中的火山平原',
        note:'琥珀色的热流在冷却的地壳间缓慢流动，远处的火山仍在呼吸。',
        scene:{mode:'open', ground:'lava', horizon:.4, sun:[.74, .47, .045], fog:.6, clouds:.5,
          layers:[[P.RIDGE, .4, .07, 1.2, .96, 0], [P.RIDGE, .4, .13, 2.0, .82, 0], [P.MESA, .39, .05, 1.5, .64, 0], [P.HILL, -.03, .1, 1.3, .12, .3]],
          landmark:{type:'volcano', x:.3, scale:.24, depth:.88},
          particles:'ember'}},
      {id:'origin-observatory', heading:'研究方向', name:'起源天文台', en:'ORIGIN OBSERVATORY', lat:31, lon:-62, alt:.02, feature:5,
        biome:'古老高地 · 嵌入岩层的天文台',
        note:'巨大的观测环半埋在层状高地中，仍对着恒星升起的方向。',
        scene:{mode:'open', ground:'rock', horizon:.36, sun:[.24, .63, .04], fog:.5, clouds:.35,
          layers:[[P.RIDGE, .36, .1, 1.4, .96, 0], [P.MESA, .36, .17, 1.0, .76, 0], [P.MESA, .02, .2, .7, .3, .5]],
          landmark:{type:'observatory', x:.62, scale:.3, depth:.6},
          particles:'dust'}}
    ]
  },

  academic: {
    code:'CANOPY', index:'02', identity:'THE LIVING WORLD', name:'SYLVANIS',
    classification:'生物密集型行星 · 森林覆盖',
    title:'在林间，<br>寻找研究的线索。',
    text:'按硕士论文研究、课程发表与文献阅读进入项目。演示与讲稿收纳在同一项目中。',
    kind:1,
    rotation:{period:260, tilt:21, clouds:1.18},
    atmosphere:{color:'#9fdcc0', thickness:.095, inner:.09, terminator:'#e0b070', clouds:.55},
    light:[-.62, .38, .68], relief:.003,
    frame:{wide:[.33, -.02, .8], tablet:[.3, -.12, .72], portrait:[0, -.32, .5]},
    ecology:{
      geology:'湿润岩体 · 巨型根系网络 · 层叠林冠',
      atmosphere:'高湿度 · 缓慢移动的雾 · 光束 · 漂浮孢子',
      motion:'植被摆动 · 孢子 · 雾层',
      architecture:'融入生命体的轻量观测结构'
    },
    palette:{skyTop:'#03110e', skyHorizon:'#548c74', sun:'#eef4c8', fog:'#6c9a84', rock:'#16221f', rock2:'#48625a', accent:'#e8c86a', veg:'#1d4a33', water:'#0e2a26'},
    regions:[
      {id:'eco-observatory', heading:'硕士论文研究', name:'生态观测站', en:'ECOLOGICAL OBSERVATORY', lat:12, lon:-38, alt:.015, feature:8,
        biome:'林冠之上的研究设施',
        note:'观测塔从林冠中升起，记录这片森林的每一次呼吸。',
        scene:{mode:'open', ground:'canopy', horizon:.42, sun:[.32, .68, .05], fog:.6, clouds:.4,
          layers:[[P.RIDGE, .42, .2, 1.3, .96, 0], [P.CROWN, .42, .06, 3.0, .76, 0], [P.CROWN, .26, .11, 1.8, .42, .5]],
          landmark:{type:'platform', x:.66, scale:.42, depth:.62},
          particles:'spore'}},
      {id:'canopy-ocean', heading:'课程发表', name:'林冠之海', en:'CANOPY OCEAN', lat:-20, lon:64, alt:.01, feature:6,
        biome:'千米级巨树组成的连续林冠',
        note:'林冠一直延伸到地平线，巨树的树冠高出云层。',
        scene:{mode:'open', ground:'canopy', horizon:.48, sun:[.84, .74, .05], fog:.65, clouds:.45,
          layers:[[P.CROWN, .48, .03, 5.0, .96, 0], [P.CROWN, .47, .05, 3.5, .82, 0], [P.CROWN, .43, .07, 2.5, .6, 0], [P.CROWN, .06, .12, 1.5, .18, .5]],
          landmark:{type:'tree', x:.64, scale:.5, depth:.7},
          particles:'spore'}},
      {id:'root-abyss', heading:'文献阅读', name:'根系深渊', en:'ROOT ABYSS', lat:38, lon:150, alt:-.01, feature:7,
        biome:'地下根系网络',
        note:'巨大的根系在地下相互连接，微弱的生物光沿着根脉流动。',
        scene:{mode:'cave', ground:'none', horizon:0, sun:[.62, 1.0, .12], fog:.7,
          layers:[[P.HILL, .14, .1, 2.2, .8, 0], [P.HILL, .0, .14, 1.4, .35, .4]],
          roof:[[P.ROOT, .02, .45, 7.0, .85, 0], [P.ROOT, .0, .3, 3.0, .45, 0]],
          particles:'spore'}}
    ]
  },

  portfolio: {
    code:'BLOOM', index:'03', identity:'THE TIDAL WORLD', name:'THALASSA',
    classification:'海洋类地行星 · 群岛与海沟',
    title:'感官经验<br>以不同形态开花。',
    text:'照片、声音、气味与身体经验，被整理成可以观看和讨论的空间提案。',
    kind:2,
    rotation:{period:240, tilt:24, clouds:1.22},
    atmosphere:{color:'#8fd2f0', thickness:.11, inner:.1, terminator:'#ffa870', clouds:.55},
    light:[-.72, .3, .62], relief:.002,
    frame:{wide:[.38, -.08, .92], tablet:[.33, -.15, .8], portrait:[.06, -.36, .56]},
    ecology:{
      geology:'同一洋盆 · 浅海陆架 · 构造海沟 · 抬升古岛',
      atmosphere:'湿润散射 · 海洋云系 · 海雾',
      motion:'潮汐涨落 · 水面涟漪 · 云影 · 洋流',
      architecture:'半没入水中的巨构 · 海岸拱门 · 水上公共空间'
    },
    palette:{skyTop:'#08202e', skyHorizon:'#a6cecb', sun:'#fff2da', fog:'#b0cece', rock:'#1f2f35', rock2:'#6a8684', accent:'#7ff0dc', veg:'#2c6656', water:'#0f5866'},
    regions:[
      {id:'tidal-mirror', heading:'作品集项目', name:'潮汐镜原', en:'TIDAL MIRROR', lat:14, lon:24, alt:.008, feature:1,
        biome:'浅海陆架上的潮间带',
        note:'退潮后的浅海像一面镜子，远处的古岛和半没入水中的环形巨构倒映其中。',
        scene:{mode:'open', ground:'water', horizon:.47, sun:[.7, .66, .055], fog:.55, clouds:.7, tide:true,
          layers:[[P.STACK, .47, .05, 6.0, .97, 0], [P.STACK, .47, .1, 3.2, .86, 0]],
          landmark:{type:'arch', x:.54, scale:.2, depth:.76},
          particles:'mist'}},
      {id:'symbiotic-coast', heading:'空间设计', name:'共生海岸', en:'SYMBIOTIC COAST', lat:36, lon:-58, alt:.012, feature:3,
        biome:'湿地海岸 · 有机海岸建筑',
        note:'潮水在湿地与连拱桥之间往返，海岸建筑和植被长在一起。',
        scene:{mode:'open', ground:'marsh', horizon:.45, sun:[.28, .6, .05], fog:.55, clouds:.6, tide:true,
          layers:[[P.STACK, .45, .14, 1.8, .96, 0], [P.CROWN, .45, .035, 6.0, .72, 0], [P.CROWN, -.02, .1, 4.0, .16, .3]],
          landmark:{type:'arcade', x:.6, scale:.17, depth:.66},
          particles:'mist'}},
      {id:'abyssal-rift', heading:'视觉实验', name:'深渊裂谷', en:'ABYSSAL RIFT', lat:-24, lon:118, alt:-.02, feature:2,
        biome:'构造海沟 · 生物发光',
        note:'海沟深处只剩下从上方渗下的微光，发光生物在洋流中缓慢移动。',
        scene:{mode:'under', ground:'none', horizon:0, sun:[.5, 1.0, 0], fog:.75,
          layers:[[P.MESA, -.1, .3, 1.2, .9, 2.4], [P.STACK, .0, .25, 2.5, .6, 1.6], [P.MESA, -.2, .3, 1.0, .25, 2.6]],
          particles:'marine'}}
    ]
  },

  archive: {
    code:'STRATA', index:'04', identity:'THE ARCHIVAL WORLD', name:'VESPER',
    classification:'暗色矿物行星 · 沉积与构造',
    title:'材料在时间中沉积，<br>留下可追溯的线索。',
    text:'朋友分享、参考案例与待整理材料，在这里分门别类保存。',
    kind:3,
    rotation:{period:340, tilt:-27, clouds:1.08},
    atmosphere:{color:'#a88ad0', thickness:.045, inner:.035, terminator:'#b070c0', clouds:.25},
    light:[-.9, .28, .3], relief:.004,
    frame:{wide:[.4, .04, .6], tablet:[.35, -.05, .58], portrait:[.04, -.3, .44]},
    ring:true,
    ecology:{
      geology:'层状沉积 · 构造断裂 · 晶体洞穴 · 矿物沙漠',
      atmosphere:'稀薄雾霭 · 矿物尘埃 · 低角度光',
      motion:'极少：尘埃、晶体微光、偶发的磁场扰动',
      architecture:'巨石碑 · 几何档案库 · 嵌入地层的巨环'
    },
    palette:{skyTop:'#040308', skyHorizon:'#3e2e4e', sun:'#e0d0f0', fog:'#2e2639', rock:'#0c0a10', rock2:'#483e56', accent:'#c27ad6', veg:'#1a1620', water:'#100c16'},
    regions:[
      {id:'amethyst-vault', heading:'朋友分享', name:'紫晶穹库', en:'AMETHYST VAULT', lat:-30, lon:-20, alt:-.01, feature:9,
        biome:'地下晶体洞穴 · 档案建筑',
        note:'晶体洞穴里保存着古老的档案环，光只从顶部的裂隙漏进来。',
        scene:{mode:'cave', ground:'none', horizon:0, sun:[.4, 1.0, .08], fog:.6,
          layers:[[P.CRYSTAL, .1, .2, 3.0, .75, 0], [P.CRYSTAL, .0, .2, 1.6, .3, .6]],
          roof:[[P.CRYSTAL, .0, .32, 4.0, .8, 0], [P.CRYSTAL, .0, .22, 2.2, .4, 0]],
          landmark:{type:'ring', x:.55, scale:.36, depth:.65},
          particles:'mineral'}},
      {id:'fault-corridor', heading:'参考案例', name:'断层走廊', en:'FAULT CORRIDOR', lat:22, lon:70, alt:.0, feature:10,
        biome:'巨型地质剖面',
        note:'断层两侧的岩壁暴露出一层层行星历史，每一层都可以被读取。',
        scene:{mode:'open', ground:'rock', horizon:.3, sun:[.5, .9, .03], fog:.55, clouds:.15, aurora:true,
          layers:[[P.MESA, .3, .08, 1.5, .96, 0], [P.MESA, .22, .45, 1.1, .62, 2.6], [P.MESA, .05, .5, .9, .3, 4.0]],
          landmark:{type:'ring', x:.5, scale:.12, depth:.9},
          particles:'dust'}},
      {id:'obsidian-dunes', heading:'待整理资料', name:'黑曜沙原', en:'OBSIDIAN DUNES', lat:8, lon:168, alt:.005, feature:11,
        biome:'黑色火山沙漠 · 半埋的巨石碑',
        note:'黑色沙丘之间露出半埋的巨石碑，偶尔有磁场扰动掠过天空。',
        scene:{mode:'open', ground:'sand', horizon:.4, sun:[.18, .48, .04], fog:.55, clouds:.2, aurora:true,
          layers:[[P.DUNE, .4, .04, 2.5, .96, 0], [P.SLAB, .39, .2, 4.5, .74, 0], [P.DUNE, .38, .06, 1.5, .7, 0], [P.DUNE, .03, .1, 1.0, .22, 0]],
          particles:'dust'}}
    ]
  }
};

// Particle presets shared by all planets; colours come from the planet palette.
window.WORLD_PARTICLES = {
  ember:   {count:220, vel:[.15, 1.1], turb:.6, size:1.8, glow:1.0, colour:'accent', colour2:'sun', mix:.25},
  dust:    {count:260, vel:[1.1, .08], turb:.3, size:1.3, glow:.45, colour:'sun', colour2:'rock2', mix:.4},
  spore:   {count:200, vel:[.12, .35], turb:1.0, size:2.0, glow:.8, colour:'accent', colour2:'sun', mix:.3},
  mist:    {count:70, vel:[.5, .02], turb:.2, size:9.0, glow:.12, colour:'fog', colour2:'sun', mix:.3},
  marine:  {count:320, vel:[.1, -.25], turb:.7, size:1.6, glow:.9, colour:'sun', colour2:'accent', mix:.35},
  mineral: {count:180, vel:[.06, .12], turb:.4, size:1.5, glow:.9, colour:'accent', colour2:'sun', mix:.5}
};
})();

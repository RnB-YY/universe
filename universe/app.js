const body = document.body;
const system = document.getElementById('system');
const surfaceShell = document.getElementById('surfaceShell');
const worldCode = document.getElementById('worldCode');
const returnOrbit = document.getElementById('returnOrbit');
const catalogue = document.getElementById('catalogue');
const listToggle = document.getElementById('listToggle');
const listClose = document.getElementById('listClose');
const scrim = document.getElementById('scrim');
const motionToggle = document.getElementById('motionToggle');
const artifactPanel = document.getElementById('artifactPanel');
const artifactClose = document.getElementById('artifactClose');

const worlds = {
  about: 'ORIGIN–01',
  academic: 'CANOPY–02',
  portfolio: 'BLOOM–03',
  archive: 'STRATA–04'
};

const biomeAssets = {
  about: 'assets/world-desert-v1.webp',
  academic: 'assets/world-rainforest-v1.webp',
  portfolio: 'assets/world-wetland-v1.webp',
  archive: 'assets/world-glacier-v1.webp'
};
const biomeLoads = new Map();
let worldVisit = 0;
let lastWorld = 'about';

function loadBiome(name) {
  if (!biomeLoads.has(name)) {
    const scene = new Image();
    scene.src = biomeAssets[name];
    biomeLoads.set(name, scene.decode().catch(() => {}));
  }
  return biomeLoads.get(name);
}

const artifacts = {
  childfriendly: {
    type: 'FRIEND’S PRESENTATION · 朋友的研究展示',
    title: '건강도시 관점에서 본 아동친화적 도시 공공공간의 생태경관 설계 전략 연구',
    meta: 'KOREAN · PDF',
    description: '朋友分享的研究展示：健康城市视角下儿童友好型城市公共空间的生态景观设计策略。保留原始 PDF 文件。',
    links: [['查看 PDF 演示', '../child-friendly-landscape/presentation.pdf']]
  },
  parkplan: {
    type: 'RESEARCH PLAN · 硕士论文研究计划',
    title: '近邻公园植被空间与老年人活动机会',
    meta: '2026 · KOREAN · 10 SLIDES',
    description: '以郑州为研究地区，比较植被空间的潜在活动机会、使用者感知与实际利用，讨论相关空间条件。附逐页韩语发表稿。',
    links: [['查看韩语研究计划', '../park-research-plan/'], ['查看韩语发表稿', '../park-research-plan/script.html']]
  },
  eco: {
    type: 'ACADEMIC PRESENTATION · 学术发表',
    title: '生态翻译学',
    meta: '2026 · HTML PRESENTATION · CHINESE',
    description: '以“翻译生态环境—适应与选择—三维转换”为主线，整理生态翻译学的核心概念，并配有适合手机阅读的中文发表稿。',
    links: [
      ['查看演示', '../eco-translatology/'],
      ['查看发表稿', '../eco-translatology/script.html']
    ]
  },
  green: {
    type: 'PAPER REVIEW · 论文发表',
    title: '绿地类型与健康老龄化',
    meta: '2026 · KOREAN PRESENTATION · 26 PAGES',
    description: '分析澳大利亚纵向研究如何比较草地、低矮植被和树冠覆盖率，并讨论其对健康城市与老龄友好景观的意义。',
    links: [
      ['查看韩语演示', '../green-ageing-study/'],
      ['查看韩语发表稿', '../green-ageing-study/script.html']
    ]
  },
  prehistoric: {
    type: 'LANDSCAPE HISTORY · 景观史课程发表',
    title: '선사적 풍경구조 · 史前景观结构',
    meta: '2026 · KOREAN PRESENTATION · 16 PAGES',
    description: '从课本出发，以法国 Pincevent 季节营地与 Çatalhöyük 定居遗址，理解自然、生活空间与共同体的关系。演示内容与韩语发表稿分别提供在线入口。',
    links: [
      ['查看韩语演示', '../prehistoric-landscape/'],
      ['查看韩语发表稿', '../prehistoric-landscape/script.html']
    ]
  },
  sensory: {
    type: 'PORTFOLIO RESEARCH · 作品集研究',
    title: '多感官公共空间',
    meta: 'ONGOING · MATERIALS IN GROWTH',
    description: '围绕视觉、听觉、嗅觉与身体经验，探索人如何形成对公共场所的理解。这个节点仍在整理，之后会继续增加图像、研究图表和空间提案。',
    links: []
  },
  profile: {
    type: 'ORIGIN · 个人坐标',
    title: '유상호 · YOO SANGHO',
    meta: 'LANDSCAPE · ECOLOGY · TRANSLATION · PUBLIC SPACE',
    description: '一个持续生长的个人知识系统。内容来自课程发表、研究阅读、视觉实验与作品集发展，重点关注环境如何影响人的经验与生活。',
    links: []
  },
  future: {
    type: 'GROWING NODE · 生长中的节点',
    title: '下一项内容将在这里生长',
    meta: 'NOT PUBLISHED YET',
    description: '这个位置用于未来的研究或作品。内容发布后，它会从种子长成新的植物，并获得独立入口。',
    links: []
  }
};

// One taxonomy record per project; files remain grouped in artifacts.links.
const taxonomy = {
 about: {label:'关于我', categories:['个人简介','研究方向']},
 academic: {label:'学术研究', categories:['硕士论文研究','课程发表','文献阅读']},
 portfolio: {label:'设计作品', categories:['作品集项目','视觉实验','空间设计']},
 archive: {label:'资料收藏', categories:['朋友分享','参考案例','待整理资料']}
};
const projectIndex = [
 {id:'parkplan',world:'academic',category:'硕士论文研究',language:'韩语',year:'2026'},
 {id:'eco',world:'academic',category:'课程发表',language:'中文',year:'2026'},
 {id:'prehistoric',world:'academic',category:'课程发表',language:'韩语',year:'2026'},
 {id:'green',world:'academic',category:'文献阅读',language:'韩语',year:'2026'},
 {id:'sensory',world:'portfolio',category:'作品集项目',language:'中文',year:'未标注'},
 {id:'childfriendly',world:'archive',category:'朋友分享',language:'韩语',year:'未标注'},
 {id:'profile',world:'about',category:'个人简介',language:'中文',year:'未标注'}
];
const wf=document.getElementById('worldFilter'),cf=document.getElementById('categoryFilter'),lf=document.getElementById('languageFilter'),yf=document.getElementById('yearFilter'),search=document.getElementById('projectSearch');
function options(select,values,label){select.replaceChildren(new Option(label,''),...values.map(v=>new Option(v.label||v,v.value||v)));}
options(wf,Object.entries(taxonomy).map(([value,t])=>({value,label:t.label})),'全部星球');
function categories(){options(cf,wf.value?taxonomy[wf.value].categories:Object.values(taxonomy).flatMap(t=>t.categories),'全部分类');}
function renderProjects(){
 const query=search.value.trim().toLocaleLowerCase();
 const found=projectIndex.filter(p=>(!wf.value||p.world===wf.value)&&(!cf.value||p.category===cf.value)&&(!lf.value||p.language===lf.value)&&(!yf.value||p.year===yf.value)&&(!query||[artifacts[p.id].title,artifacts[p.id].description,p.category,p.language,taxonomy[p.world].label].join(' ').toLocaleLowerCase().includes(query)));
 const root=document.getElementById('projectResults');root.replaceChildren();
 document.getElementById('resultCount').textContent=`${found.length} 个项目`;
 found.forEach(p=>{const item=artifacts[p.id],button=document.createElement('button');button.type='button';button.className='catalogue-item';const title=document.createElement('span'),meta=document.createElement('small');title.textContent=item.title;meta.textContent=`${taxonomy[p.world].label} / ${p.category} · ${p.language} · ${p.year} · ${item.links.length ? item.links.length+' 个文件入口':'整理中'}`;button.append(title,meta);button.addEventListener('click',()=>openArtifact(p.id));root.append(button);});
 if(!found.length){const empty=document.createElement('p');empty.className='empty-results';empty.textContent='此分类暂无项目，或没有符合筛选条件的内容。';root.append(empty);}
}
function browseCategory(world,category){wf.value=world;categories();cf.value=category;lf.value='';yf.value='';search.value='';renderProjects();openCatalogue();}
document.querySelectorAll('[data-categories]').forEach(root=>{const world=root.dataset.categories;taxonomy[world].categories.forEach((category,i)=>{const button=document.createElement('button');button.type='button';button.className='category-entry';const label=document.createElement('b'),meta=document.createElement('small');label.textContent=category;const count=projectIndex.filter(p=>p.world===world&&p.category===category).length;meta.textContent=count ? count+' 个项目 →':'待收录 →';button.append(label,meta);button.addEventListener('click',()=>browseCategory(world,category));root.append(button);});});
wf.addEventListener('change',()=>{categories();renderProjects();});[cf,lf,yf].forEach(e=>e.addEventListener('change',renderProjects));search.addEventListener('input',renderProjects);
document.getElementById('clearFilters').addEventListener('click',()=>{wf.value='';categories();lf.value='';yf.value='';search.value='';renderProjects();});
categories();renderProjects();

function pauseOrbits(paused) {
  body.classList.toggle('orbits-paused', paused);
}

function openWorld(name) {
  if (!worlds[name]) return;
  const visit = ++worldVisit;
  closeCatalogue();
  pauseOrbits(true);
  body.classList.add('is-traveling');
  lastWorld = name;
  // cosmos.js flies the camera into the planet; fall back to a plain delay without it.
  const travel = window.cosmos ? window.cosmos.travel(name) : new Promise(resolve => window.setTimeout(resolve, body.dataset.motion === 'reduced' ? 0 : 560));
  // Wait briefly for the surface image, but never let a slow decode block navigation.
  const scene = Promise.race([loadBiome(name), new Promise(resolve => window.setTimeout(resolve, 1500))]);
  Promise.all([scene, travel]).then(() => {
    if (visit !== worldVisit) return;
    surfaceShell.dataset.biome = name;
    document.querySelectorAll('[data-world-panel]').forEach(panel => {
      const active = panel.dataset.worldPanel === name;
      panel.classList.toggle('is-active', active);
      panel.setAttribute('aria-hidden', String(!active));
    });
    worldCode.textContent = worlds[name] || 'ORBITAL–00';
    surfaceShell.classList.add('is-visible');
    surfaceShell.setAttribute('aria-hidden', 'false');
    body.classList.remove('is-traveling');
    returnOrbit.focus({preventScroll:true});
  });
}

function closeWorld() {
  worldVisit++;
  body.classList.remove('is-traveling');
  if (artifactPanel.open) artifactPanel.close();
  surfaceShell.classList.remove('is-visible');
  surfaceShell.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('[data-world-panel]').forEach(panel => {
    panel.classList.remove('is-active');
    panel.setAttribute('aria-hidden', 'true');
  });
  if (body.dataset.motion !== 'reduced') pauseOrbits(false);
  window.cosmos?.arrive();
  // The stage stays inert until the surface observer runs, so focus on the next task.
  setTimeout(() => document.querySelector(`.system .planet[data-world="${lastWorld}"]`)?.focus({preventScroll:true}));
}

function openArtifact(id) {
  const item = artifacts[id];
  if (!item) return;
  const record=projectIndex.find(p=>p.id===id);
  document.getElementById('artifactType').textContent = record ? taxonomy[record.world].label+' / '+record.category+' / 项目' : item.type;
  document.getElementById('artifactTitle').textContent = item.title;
  document.getElementById('artifactMeta').textContent = item.meta;
  document.getElementById('artifactDescription').textContent = item.description;
  const links = document.getElementById('artifactLinks');
  links.replaceChildren();
  if (item.links.length) {
    item.links.forEach(([label, href]) => {
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      links.append(link);
    });
  } else {
    const note = document.createElement('span');
    note.textContent = '内容整理中';
    note.style.cssText = 'color:#77848a;font-size:12px;letter-spacing:.08em';
    links.append(note);
  }
  if (!artifactPanel.open) artifactPanel.showModal();
}

function openCatalogue() {
  catalogue.inert = false;
  catalogue.classList.add('is-open');
  catalogue.setAttribute('aria-hidden', 'false');
  listToggle.setAttribute('aria-expanded', 'true');
  scrim.hidden = false;
  pauseOrbits(true);
  listClose.focus({preventScroll:true});
}

function closeCatalogue() {
  catalogue.inert = true;
  catalogue.classList.remove('is-open');
  catalogue.setAttribute('aria-hidden', 'true');
  listToggle.setAttribute('aria-expanded', 'false');
  scrim.hidden = true;
  if (body.dataset.motion !== 'reduced' && !surfaceShell.classList.contains('is-visible')) pauseOrbits(false);
}

document.querySelectorAll('[data-world]').forEach(button => {
  button.addEventListener('click', () => openWorld(button.dataset.world));
  button.addEventListener('pointerenter', () => loadBiome(button.dataset.world), {once:true});
  button.addEventListener('focus', () => loadBiome(button.dataset.world), {once:true});
});
document.querySelectorAll('[data-artifact]').forEach(button => button.addEventListener('click', () => openArtifact(button.dataset.artifact)));
returnOrbit.addEventListener('click', closeWorld);
artifactClose.addEventListener('click', () => artifactPanel.close());
listToggle.addEventListener('click', openCatalogue);
listClose.addEventListener('click', closeCatalogue);
scrim.addEventListener('click', closeCatalogue);

motionToggle.addEventListener('click', () => {
  const reduced = body.dataset.motion !== 'reduced';
  body.dataset.motion = reduced ? 'reduced' : 'full';
  pauseOrbits(reduced);
  motionToggle.setAttribute('aria-pressed', String(reduced));
  motionToggle.textContent = reduced ? '恢复轨道' : '暂停轨道';
  try { localStorage.setItem('orbital-motion', body.dataset.motion); } catch {}
  window.cosmos?.invalidate();
});

let storedMotion = null;
try { storedMotion = localStorage.getItem('orbital-motion'); } catch {}
if (storedMotion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
  body.dataset.motion = 'reduced';
  pauseOrbits(true);
  motionToggle.setAttribute('aria-pressed', 'true');
  motionToggle.textContent = '恢复轨道';
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (artifactPanel.open) artifactPanel.close();
  else if (catalogue.classList.contains('is-open')) closeCatalogue();
  else if (surfaceShell.classList.contains('is-visible')) closeWorld();
});

new MutationObserver(()=>{
 const active=surfaceShell.classList.contains('is-visible');
 body.classList.toggle('surface-open',active);
 document.getElementById('orbit').inert=active;
 document.querySelector('.site-header').inert=active;
}).observe(surfaceShell,{attributes:true,attributeFilter:['class']});

catalogue.inert = true;
artifactPanel.setAttribute('aria-labelledby','artifactTitle');

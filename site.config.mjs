// 站点配置：改这里就能改掉整站的名字、简介和链接
export default {
  title: '叶志汉',
  handle: 'Zhihan',
  // 站点部署在域名根目录时用 '/'；部署在 GitHub Pages 子路径时改成 '/仓库名/'
  base: '/',
  origin: 'http://127.0.0.1:4173',
  lang: 'zh-CN',
  description: '叶志汉的个人博客：大模型推理优化、算法竞赛与工程实践。',
  tagline: '在推理系统里寻找下一个瓶颈',
  hero: {
    eyebrow: '杭州 · 杭州师范大学 · 计算机科学与技术 · 2023',
    // 支持 <em> 高亮
    title: '在推理系统里<br>寻找下一个<em>瓶颈</em>',
    lede: '我是叶志汉。这里记录我对大模型推理优化、算法竞赛与工程实践的理解——尽量把来龙去脉讲清楚，而不是只给结论。',
  },
  // 留空则不在页面上显示邮箱；想公开就把地址填回来
  email: '',
  socials: [
    // href 留空则不在页面上显示
    { label: 'GitHub', href: 'https://github.com/yaLen404' },
    { label: '知乎', href: '' },
  ],
  now: '目前在折腾 nano-vllm 上的 MoE 推理与投机解码，也在准备下一场区域赛。',
};

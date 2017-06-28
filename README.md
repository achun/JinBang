# JinBang

河南高考数据汇总, 数据来源 [河南省招生办公室网站](http://www.heao.gov.cn/)

数据文件位置及重要结构解释

```
data
├── base.js    schools 段结构 {省份代号: [院校代号]}
├── history.js 上年录取 {科别代号: [院校代号, 计划录取, 实际录取, 最低录取分数]}
├── plans.js   {院校代号: {批次代号: {科别代号: {专业代号: {total: 计划录取}}}}}
└── schools.js 院校基本信息, 可用于生成信息表格
```

plans.js 中叶子对象的 href 属性保存原始页面地址.

**每年的数据都是固定的, 请勿使用本工具反复抓取数据**

# TODO

 1. gh-pages 分支
 2. 一个长图表囊括所有重要信息, 左文右理, 中间是分数段

# License

Apache License 2.0 Copyright 2017 @[YU HengChun](https://github.com/achun)
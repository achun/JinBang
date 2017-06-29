# JinBang

河南高考数据汇总, 数据来源 [河南省招生办公室网站](http://www.heao.gov.cn/)

data 目录下的数据文件位置及重要结构解释

```
base.json    schools 段结构 {省份代号: [院校代号]}

plans.json   {院校代号: {批次代号: {科别代号: {专业代号: {total: 计划录取}}}}}
             叶子对象的 href 属性保存原始页面地址

history.json 上年最低录取分数情况
             Deprecated 本年无招生计划的院校 {院校代号: 院校名称}
             Renamed    本年名称变化的院校 {院校代号: {old: 原用名, now: 现用名}
             批次代号   {科别代号:[[最低录取分数, 院校代号...]]}
                        是依照本年批次代号, 科别代号整理的最低录取分降序数据,
                        相同最低录取分数的院校收纳到一起

schools.json 院校基本信息, 可用于生成信息表格
```


**每年的数据都是固定的, 请勿使用本工具反复抓取数据**

# TODO

 1. gh-pages 分支
 2. 一个长图表囊括所有重要信息, 左文右理, 中间是分数段

# License

Apache License 2.0 Copyright 2017 @[YU HengChun](https://github.com/achun)
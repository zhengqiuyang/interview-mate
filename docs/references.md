# 参考的知名开源项目与设计取舍

InterviewMate 不是从零发明的——面试准备这个领域在开源社区已经被反复打磨过。我们站在下面这些项目的肩膀上，把「静态知识」翻译成了「交互式陪练」。

## 知识库类（题库与答案风格的来源）

### [CyC2018/CS-Notes](https://github.com/CyC2018/CS-Notes)
技术面试基础知识库的经典之作，以「算法、操作系统、网络、面向对象、数据库、Java、系统设计」的分类体系和高度提炼的要点式笔记著称。

- **借鉴**：`data/questions.json` 的九大分类直接沿用了这套经过验证的知识切分；参考答案保持「要点列表 + 加分项」的紧凑风格——面试场景需要的不是教材，是可背诵、可展开的骨架。

### [Snailclimb/JavaGuide](https://github.com/Snailclimb/JavaGuide)
Java 学习与面试指南，覆盖 Java 基础、集合、并发、JVM、Spring、分布式、数据库。

- **借鉴**：高频题的选取标准（在真实面试中出现率）、以及「一个问题带出一串追问」的出题路径——我们的 AI 追问提示词（概念 → 原理 → 边界 → 权衡）就是把这个路径程序化。

### [doocs/advanced-java](https://github.com/doocs/advanced-java)
互联网 Java 工程师进阶知识扫盲：高并发、分布式、高可用、海量数据。

- **借鉴**：后端 & 分布式类目的深度校准（消息队列三问、分布式锁的坑、幂等设计），这类题在我们题库里占了独立类目。

### [yangshun/tech-interview-handbook](https://github.com/yangshun/tech-interview-handbook)
英文世界最有名的面试宝典之一，含 Grind 75 算法清单和完整的行为面试攻略。

- **借鉴**：行为面试类目的方法论——STAR 框架、自我介绍结构、反问环节策略；算法题的难度分级（我们用 ●/●●/●●● 三级）。

### [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer)
系统设计学习圣经。

- **借鉴**：系统设计题的答题框架（明确需求 → 估算量级 → 核心设计 → 数据结构 → 扩展），我们题库里短链/秒杀/点赞/IM 四道题的参考答案都按这个框架组织，AI 面试官的追问也按这个梯度展开。

### [trekhleb/javascript-algorithms](https://github.com/trekhleb/javascript-algorithms)
用 JavaScript 实现的算法与数据结构大全。

- **借鉴**：前端类目与算法类目的覆盖面参照它的结构（线性表/哈希/排序/搜索/DP/双指针），保证常考结构无遗漏。

### [afatcoder/Backoffer](https://github.com/afatcoder/Backoffer)
真实面经合集。

- **借鉴**：从真实面经里提取「面试官实际会追问什么」，校准题库答案里的「加分项」部分。

## 交互形态类（产品形态的参照）

AI 面试陪练类项目（如各类 InterviewGPT / AI Mock Interview 项目）验证了「对话式模拟 + 结构化报告」这个形态的价值，但普遍存在三类问题：依赖特定厂商 API、需要 Docker 复杂部署、数据上云。

InterviewMate 的取舍：

1. **零依赖、单命令启动** —— `node server.js` 即用，降低团队内推广成本；
2. **任意 OpenAI 兼容后端** —— 智谱/OpenAI/DeepSeek/Kimi/本地 Ollama 一键切换，不被单一厂商锁定；
3. **数据不出本机** —— 记录与密钥留在浏览器 localStorage，唯一的网络请求就是模型调用本身；
4. **离线优先的题库** —— 没有 Key 也完整可用，AI 只是增强而非前提。

## 我们遵守的边界

- 所有参考项目均为开源（MIT/CC 等），我们在 README 与本文件中明确致谢并附链接；
- 题库内容为基于公开知识的原创整理，非对任何项目的批量搬运；
- 若后续直接引用某项目的原文内容，将在题目元数据中标注来源并遵循其许可证。

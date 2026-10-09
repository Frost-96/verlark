// PROTOTYPE ONLY: authored samples, not reviewed/published learning content.
export const materials = [
  {
    id: "weekend",
    title: "聊聊你的周末计划",
    english: "A little time for yourself",
    topic: "周末计划",
    description: "听听两位朋友如何安排周末，再说说你想怎么过。",
    task: "这个周末，你打算做什么？说说你的计划，以及想这样安排的原因。",
    hint: "I'm thinking of… / I might… / because…",
    sample:
      "I'm thinking of going to a café this weekend. I might bring a book because I want to relax.",
    dialogue: [
      "Maya: Do you have any plans for the weekend?",
      "Ben: I'm thinking of trying that new café near the park.",
      "Maya: That sounds nice. Are you going with anyone?",
      "Ben: Maybe with my sister. I want to spend some time with her.",
      "Maya: I might stay home and read. It's been a busy week.",
    ],
    translation:
      "Maya 问起周末的安排。Ben 想和姐姐去公园附近新开的咖啡馆，Maya 则可能留在家里看书，因为这一周很忙。",
  },
  {
    id: "introduce",
    title: "认识一个新朋友",
    english: "A simple hello",
    topic: "介绍自己",
    description: "从住在哪里、喜欢什么，开始一次简单的交流。",
    task: "向刚认识的朋友介绍自己，说一件你最近喜欢做的事。",
    hint: "I live in… / In my free time…",
    sample:
      "I live in Shanghai. In my free time, I like taking photos around the city.",
    dialogue: [
      "Maya: Hi, I'm Maya. I just moved here.",
      "Ben: Nice to meet you. I'm Ben. What do you like doing?",
      "Maya: I like taking photos, especially in the park.",
    ],
    translation:
      "Maya 刚搬来这里。她向 Ben 介绍自己，并聊起自己喜欢在公园拍照。",
  },
  {
    id: "day",
    title: "说说平常的一天",
    english: "The everyday things",
    topic: "描述一天",
    description: "聊聊日常节奏，以及一天里最喜欢的时刻。",
    task: "说说你平常的一天，以及最喜欢的一个时刻。",
    hint: "I usually… / My favorite part is…",
    sample:
      "I usually start work at nine. My favorite part of the day is walking home.",
    dialogue: [
      "Ben: What does a normal day look like for you?",
      "Maya: I usually start work at nine. After work, I go for a walk.",
      "Ben: That sounds relaxing.",
    ],
    translation: "Maya 通常九点开始工作，下班以后会去散步。",
  },
  {
    id: "likes",
    title: "分享你的小爱好",
    english: "Something you enjoy",
    topic: "表达喜好",
    description: "不只说喜欢，也说说它为什么吸引你。",
    task: "介绍一个你喜欢的活动，并说说原因。",
    hint: "I'm really into… / It helps me…",
    sample: "I'm really into cooking. It helps me relax after a busy day.",
    dialogue: [
      "Maya: What do you do to relax?",
      "Ben: I'm really into cooking. I like trying new recipes.",
      "Maya: What do you like making?",
      "Ben: Mostly simple pasta dishes.",
    ],
    translation: "Ben 喜欢做饭，也喜欢尝试新食谱。他通常做简单的意面。",
  },
  {
    id: "invite",
    title: "发出一个轻松的邀请",
    english: "Want to join me?",
    topic: "邀请与拒绝",
    description: "提出邀约，也给对方留出选择的空间。",
    task: "邀请一位朋友参加一个活动，说说时间与安排。",
    hint: "Would you like to…? / How about…?",
    sample:
      "Would you like to have lunch on Saturday? How about the café near the park?",
    dialogue: [
      "Ben: Would you like to have lunch on Saturday?",
      "Maya: I'd love to, but I'm busy that day. How about Sunday?",
      "Ben: Sunday works for me.",
    ],
    translation: "Ben 邀请 Maya 周六吃午饭，Maya 当天有事，提出改到周日。",
  },
  {
    id: "reason",
    title: "把原因说清楚",
    english: "Here's why",
    topic: "解释原因",
    description: "把一个选择和背后的原因连起来。",
    task: "说说你最近做的一个小决定，以及这样选择的原因。",
    hint: "I decided to… / because…",
    sample:
      "I decided to walk to work because I wanted to spend more time outside.",
    dialogue: [
      "Maya: Why did you decide to walk today?",
      "Ben: Because the weather is nice, and I wanted some fresh air.",
      "Maya: That's a good idea.",
    ],
    translation: "Ben 因为天气不错、想呼吸新鲜空气，决定步行。",
  },
];
export type Material = (typeof materials)[number];
export type Attempt = {
  id: number;
  text: string;
  revision: number;
  status:
    | "transcribing"
    | "transcript-error"
    | "confirm"
    | "feedback-pending"
    | "feedback-error"
    | "feedback";
  feedbackRevision?: number;
  previous: { text: string; revision: number }[];
};
export type Practice = {
  id: number;
  materialId: string;
  ended: boolean;
  attempts: Attempt[];
};
export const statusLabels: Record<Attempt["status"], string> = {
  transcribing: "识别中",
  "transcript-error": "识别失败",
  confirm: "待核对",
  "feedback-pending": "生成反馈中",
  "feedback-error": "反馈失败",
  feedback: "已有表达反馈",
};

export const alternatives: Record<string, string> = {
  weekend:
    "This weekend, I might take a book to a café and spend some time relaxing.",
  introduce:
    "I'm based in Shanghai, and I enjoy exploring the city with my camera.",
  day: "My workday usually begins at nine. I especially enjoy the walk home.",
  likes: "After a busy day, I find cooking really relaxing.",
  invite:
    "Are you free for lunch on Saturday? We could try the café near the park.",
  reason: "I wanted more time outdoors, so I chose to walk to work.",
};

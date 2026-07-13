export interface StorySection {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
}

export const storySections: StorySection[] = [
  {
    id: "hero",
    eyebrow: "PowerBox",
    title: "Цифровой сигнал. Физический свет.",
    body: "Восьмиканальный контроллер для световых и медиаинсталляций.",
  },
  {
    id: "problem",
    eyebrow: "Задача",
    title: "Световая система не должна превращаться в хаос.",
    body: "PowerBox собирает управление приборами в один понятный центр.",
  },
  {
    id: "channels",
    eyebrow: "8 каналов",
    title: "Каждый источник света под отдельным контролем.",
    body: "Включайте приборы независимо или управляйте ими как одной системой.",
  },
  {
    id: "control",
    eyebrow: "Control",
    title: "TouchDesigner, UDP, Web UI и MIDI.",
    body: "Соединяйте цифровые команды с реальными световыми объектами.",
  },
  {
    id: "reliability",
    eyebrow: "Engineering",
    title: "Продуманная структура внутри.",
    body: "Силовая часть, логика управления и восемь каналов собраны в одном устройстве.",
  },
  {
    id: "installation",
    eyebrow: "Installation",
    title: "Свет становится участником пространства.",
    body: "Для выставок, перформансов, медиасцен и экспериментальных инсталляций.",
  },
  {
    id: "contact",
    eyebrow: "PowerBox",
    title: "Соберите свою световую систему.",
    body: "Обсудите конфигурацию и интеграцию PowerBox в ваш проект.",
  },
];

export interface StorySection {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
}

export const storySections: StorySection[] = [
  {
    id: "control",
    eyebrow: "Multiple inputs",
    title: "Один сигнал. Восемь физических событий.",
    body: "TouchDesigner, MIDI, UDP и Web UI превращают цифровые команды в мгновенную реакцию света.",
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
    id: "hero",
    eyebrow: "PowerBox Light Install",
    title: "Цифровой сигнал. Физический свет.",
    body: "Восьмиканальный контроллер, который соединяет музыку, цифровое управление и реальные светильники в одну живую систему.",
  },
  {
    id: "reliability",
    eyebrow: "Engineering",
    title: "Продуманная структура внутри.",
    body: "Силовая часть, логика управления и восемь каналов собраны в одном устройстве.",
  },
  {
    id: "contact",
    eyebrow: "PowerBox",
    title: "Соберите свою световую систему.",
    body: "Обсудите конфигурацию и интеграцию PowerBox в ваш проект.",
  },
];

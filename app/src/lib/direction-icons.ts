import {
  Activity,
  Baby,
  BookOpen,
  Brain,
  Brush,
  Calculator,
  Dumbbell,
  Gamepad2,
  Globe,
  Heart,
  Languages,
  Mic,
  Microscope,
  Music,
  Palette,
  PenTool,
  Sparkles,
  Star,
  Theater,
  Trophy,
  type LucideIcon,
} from "lucide-react"

export interface DirectionIconOption {
  name: string
  label: string
  Icon: LucideIcon
}

export const DIRECTION_ICONS: DirectionIconOption[] = [
  { name: "palette", label: "Творчество", Icon: Palette },
  { name: "book-open", label: "Обучение", Icon: BookOpen },
  { name: "music", label: "Музыка", Icon: Music },
  { name: "brush", label: "Рисование", Icon: Brush },
  { name: "languages", label: "Языки", Icon: Languages },
  { name: "calculator", label: "Математика", Icon: Calculator },
  { name: "dumbbell", label: "Фитнес", Icon: Dumbbell },
  { name: "activity", label: "Спорт", Icon: Activity },
  { name: "sparkles", label: "Магия", Icon: Sparkles },
  { name: "baby", label: "Малыши", Icon: Baby },
  { name: "brain", label: "Мышление", Icon: Brain },
  { name: "heart", label: "Здоровье", Icon: Heart },
  { name: "trophy", label: "Соревнования", Icon: Trophy },
  { name: "star", label: "Звезда", Icon: Star },
  { name: "gamepad", label: "Игры", Icon: Gamepad2 },
  { name: "microscope", label: "Наука", Icon: Microscope },
  { name: "globe", label: "География", Icon: Globe },
  { name: "mic", label: "Вокал", Icon: Mic },
  { name: "theater", label: "Театр", Icon: Theater },
  { name: "pen-tool", label: "Графика", Icon: PenTool },
]

export const DEFAULT_DIRECTION_ICON = "palette"

export const DIRECTION_ICON_NAMES = DIRECTION_ICONS.map(i => i.name)

export function getDirectionIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Palette
  return DIRECTION_ICONS.find(i => i.name === name)?.Icon ?? Palette
}

export type ChronicleVisibility = 'private' | 'public'

export interface ChronicleEntry {
  createdAt: number
  createdByUserId: string | null
  id: string
  label: string
  note: string
  updatedAt: number
  visibility: ChronicleVisibility
  year: number
}

export interface CharacterAgeProfile {
  id: string
  anchorAge: number
  anchorYear: number
  color: string
  name: string
}

export const sampleChronicleEntries: ChronicleEntry[] = [
  {
    createdAt: 0,
    createdByUserId: null,
    id: 'chronicle_177',
    label: '新纪年 177',
    note: '负层夹缝、硕鼠粮仓。',
    updatedAt: 0,
    visibility: 'public',
    year: 177,
  },
  {
    createdAt: 0,
    createdByUserId: null,
    id: 'chronicle_180',
    label: '新纪年 180',
    note: '竞选年、慈善领养。',
    updatedAt: 0,
    visibility: 'public',
    year: 180,
  },
  {
    createdAt: 0,
    createdByUserId: null,
    id: 'chronicle_184',
    label: '新纪年 184',
    note: '作为后续节点，用来验证自定义编年扩展后年龄是否持续自动推算。',
    updatedAt: 0,
    visibility: 'public',
    year: 184,
  },
]

export const sampleCharacterProfiles: CharacterAgeProfile[] = [
  {
    id: 'char_liuzhizhou',
    name: '柳之舟',
    anchorYear: 177,
    anchorAge: 11,
    color: '#a46245',
  },
  {
    id: 'char_liuzhiqing',
    name: '柳之清',
    anchorYear: 177,
    anchorAge: 10,
    color: '#2a9a8b',
  },
  {
    id: 'char_yaoguang',
    name: '爻光',
    anchorYear: 180,
    anchorAge: 14,
    color: '#42a2de',
  },
  {
    id: 'char_bangyi',
    name: '邦伊',
    anchorYear: 177,
    anchorAge: 5,
    color: '#dcde42',
  },
]

export function calculateCharacterAge(year: number, profile: CharacterAgeProfile): number {
  return profile.anchorAge + (year - profile.anchorYear)
}

export function formatCharacterAge(age: number): string {
  if (age < 0) {
    return '未出生'
  }

  return `${age} 岁`
}

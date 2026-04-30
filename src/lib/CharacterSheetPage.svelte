<svelte:options runes={false} />

<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { buildChatHttpUrl } from './chat-room'
  import {
    calculateDerivedStats,
    clampCharacterSheetAttribute,
    createDefaultCharacterSheetAttributes,
    resolveBaseSkillValue,
    type CharacterSheetAttributeKey,
  } from './character-sheet-engine'
  import {
    characterSheetBaseSkills,
    characterSheetOccupations,
    type CharacterSheetOccupationData,
  } from './character-sheet-data'
  import type { ChatCharacterAttributes, ChatCharacterCard, ChatCharacterSkill } from './chat-room'
  import CustomSelect from './components/CustomSelect.svelte'

  type SkillPointField = 'occupationPoints' | 'interestPoints' | 'growthPoints'
  type SkillCategoryId = 'combat' | 'investigation' | 'academic' | 'social' | 'craft' | 'mythos' | 'other'
  type CharacterSheetAttributesState = ReturnType<typeof createDefaultCharacterSheetAttributes>

  interface CharacterSheetSkillAllocation {
    baseValue: number
    growthPoints: number
    id: string
    interestPoints: number
    name: string
    occupationPoints: number
    originalName: string
  }

  interface SkillCategory {
    id: SkillCategoryId
    label: string
    note: string
  }

  interface SkillCategoryGroup {
    category: SkillCategory
    skills: CharacterSheetSkillAllocation[]
  }

  interface CharacterSelectOption {
    id: string
    label: string
  }

  interface CharacterCardsResponse {
    cards?: ChatCharacterCard[]
    message?: string
    ok: boolean
  }

  interface CharacterCardSaveResponse {
    card?: ChatCharacterCard | null
    message?: string
    ok: boolean
  }

  export let onBack: () => void = () => {}
  export let activeCharacterId: string | null = null
  export let authUserId = ''
  export let worldviewOptions: string[] = []

  const ATTRIBUTE_FIELDS: Array<{ key: CharacterSheetAttributeKey; label: string; short: string }> = [
    { key: 'STR', label: '力量', short: 'STR' },
    { key: 'CON', label: '体质', short: 'CON' },
    { key: 'SIZ', label: '体型', short: 'SIZ' },
    { key: 'DEX', label: '敏捷', short: 'DEX' },
    { key: 'APP', label: '外貌', short: 'APP' },
    { key: 'INT', label: '智力', short: 'INT' },
    { key: 'POW', label: '意志', short: 'POW' },
    { key: 'EDU', label: '教育', short: 'EDU' },
    { key: 'LUCK', label: '幸运', short: 'LUCK' },
  ]

  const ATTRIBUTE_KEY_MAP: Record<CharacterSheetAttributeKey, keyof ChatCharacterAttributes> = {
    APP: 'appearance',
    CON: 'constitution',
    DEX: 'dexterity',
    EDU: 'education',
    INT: 'intelligence',
    LUCK: 'luck',
    POW: 'willpower',
    SIZ: 'size',
    STR: 'strength',
  }

  const SKILL_CATEGORIES: SkillCategory[] = [
    { id: 'combat', label: '战斗类', note: '闪避、格斗、射击与投掷相关。' },
    { id: 'investigation', label: '调查类', note: '线索发现、潜入、追踪与现场处理。' },
    { id: 'academic', label: '学术类', note: '知识、语言、医学与理论研究。' },
    { id: 'social', label: '交涉类', note: '信誉、话术、说服与心理判断。' },
    { id: 'craft', label: '技艺类', note: '工艺、维修、电子与实作能力。' },
    { id: 'mythos', label: '🟥', note: '你想好了吗？' },
    { id: 'other', label: '其他类', note: '移动、驾驶、特殊训练与自定义技能。' },
  ]

  const COMBAT_SKILLS = ['闪避', '格斗', '射击', '步枪', '手枪', '投掷', '炮术', '爆破']
  const INVESTIGATION_SKILLS = ['乔装', '图书馆使用', '聆听', '锁匠', '妙手', '侦查', '潜行', '计算机使用']
  const ACADEMIC_SKILLS = [
    '会计',
    '人类学',
    '考古学',
    '历史',
    '外语',
    '母语',
    '法律',
    '博物学',
    '神秘学',
    '科学',
    '学识',
  ]
  const CRAFT_SKILLS = ['技艺', '电气维修', '电子学', '急救', '机械维修', '医学', '精神分析']
  const SOCIAL_SKILLS = ['信用评级', '取悦', '话术', '恐吓', '说服', '心理学']
  const MYTHOS_SKILLS = ['克苏鲁神话']
  const SPECIALISABLE_SKILL_PATTERN = /^(技艺|格斗|射击|外语|科学)[①②③④⑤⑥⑦⑧⑨].*$/u
  const SPECIALISED_SKILL_OPTIONS: Record<string, string[]> = {
    '技艺①': [
      '表演',
      '美术',
      '摄影',
      '伪造',
      '写作',
      '书法',
      '乐理',
      '厨艺',
      '裁缝',
      '理发',
      '建筑',
      '舞蹈',
      '酿酒',
      '捕鱼',
      '歌唱',
      '制陶',
      '雕塑',
      '杂技',
      '风水',
      '技术制图',
      '耕作',
      '打字',
      '速记',
      '木匠',
      '莫里斯舞蹈',
      '歌剧歌唱',
      '粉刷匠与油漆工',
      '吹真空管',
    ],
    '技艺②': [
      '表演',
      '美术',
      '摄影',
      '伪造',
      '写作',
      '书法',
      '乐理',
      '厨艺',
      '裁缝',
      '理发',
      '建筑',
      '舞蹈',
      '酿酒',
      '捕鱼',
      '歌唱',
      '制陶',
      '雕塑',
      '杂技',
      '风水',
      '技术制图',
      '耕作',
      '打字',
      '速记',
      '木匠',
      '莫里斯舞蹈',
      '歌剧歌唱',
      '粉刷匠与油漆工',
      '吹真空管',
    ],
    '格斗①': ['鞭子', '电锯', '链枷', '绞具', '斧', '剑', '矛'],
    '格斗②': ['鞭子', '电锯', '链枷', '绞具', '斧', '剑', '矛'],
    '射击①': ['冲锋枪', '弓术', '喷射器', '机枪', '重武器'],
    '科学①': ['地质学', '化学', '生物学', '数学', '天文学', '物理学', '药学', '植物学', '动物学', '密码学', '工程学', '气象学', '司法科学'],
    '科学②': ['地质学', '化学', '生物学', '数学', '天文学', '物理学', '药学', '植物学', '动物学', '密码学', '工程学', '气象学', '司法科学'],
  }

  const OCCUPATION_SKILL_ALIASES: Record<string, string[]> = {
    博物学: ['自然'],
    汽车驾驶: ['汽车驾驶', '驾驶'],
    考古学: ['考古'],
    图书馆使用: ['图书馆'],
    骑术: ['骑乘'],
  }

  let selectedWorldview = ''
  let isCharacterCardsLoading = false
  let isPersistingSelectedCharacter = false
  let selectedOccupationId = 2
  let manualOccupationPoints = 0
  let persistNotice = ''
  let persistError = ''
  let skillQuery = ''
  let attributes = createDefaultCharacterSheetAttributes()
  let persistSelectedCharacterTimer: ReturnType<typeof setTimeout> | null = null
  let persistRequestToken = 0
  let characterCards: ChatCharacterCard[] = []
  let skillAllocations: CharacterSheetSkillAllocation[] = characterSheetBaseSkills.map((skill) => ({
    ...skill,
    growthPoints: 0,
    interestPoints: 0,
    occupationPoints: 0,
    originalName: skill.name,
  }))

  $: selectedOccupation =
    characterSheetOccupations.find((occupation) => occupation.id === selectedOccupationId) ??
    characterSheetOccupations[0]
  $: currentAttributes = getCurrentAttributes()
  $: derivedStats = calculateDerivedStats(currentAttributes, selectedOccupation?.pointFormula ?? '')
  $: availableOccupationPoints = derivedStats.occupationPoints ?? manualOccupationPoints
  $: totalOccupationAssigned = skillAllocations.reduce((sum, skill) => sum + skill.occupationPoints, 0)
  $: totalInterestAssigned = skillAllocations.reduce((sum, skill) => sum + skill.interestPoints, 0)
  $: totalGrowthAssigned = skillAllocations.reduce((sum, skill) => sum + skill.growthPoints, 0)
  $: remainingOccupationPoints = availableOccupationPoints - totalOccupationAssigned
  $: remainingInterestPoints = derivedStats.interestPoints - totalInterestAssigned
  $: pointBudgetHasWarning = remainingOccupationPoints < 0 || remainingInterestPoints < 0
  $: filteredSkillGroups = buildFilteredSkillGroups(skillAllocations, skillQuery)
  $: filteredCharacterCards = getFilteredCharacterCards(characterCards, selectedWorldview)
  $: characterSelectOptions = buildCharacterSelectOptions(filteredCharacterCards)
  $: selectedCharacterCard =
    activeCharacterId === null ? null : characterCards.find((entry) => entry.id === activeCharacterId) ?? null
  $: characterSkillStateKey = getCharacterSkillStateKey(selectedCharacterCard)
  $: selectedWorldview = ensureSelectedWorldview(selectedWorldview, worldviewOptions)
  $: if (selectedWorldview !== handledWorldviewFilter) {
    handledWorldviewFilter = selectedWorldview
    void loadCharacterCards(selectedWorldview)
  }
  $: if (authUserId !== handledAuthUserId) {
    handledAuthUserId = authUserId
    activeCharacterId = null
    characterCards = []
    void loadCharacterCards(selectedWorldview)
  }
  $: if (characterSkillStateKey !== handledCharacterSkillStateKey) {
    handledCharacterSkillStateKey = characterSkillStateKey
    skillAllocations = buildSkillAllocationsFromCharacter(selectedCharacterCard)
  }
  $: if (
    activeCharacterId !== null &&
    !filteredCharacterCards.some((entry) => entry.id === activeCharacterId)
  ) {
    activeCharacterId = null
  }

  let handledCharacterSkillStateKey = ''
  let handledAuthUserId = authUserId
  let handledWorldviewFilter: string | null = null

  onMount(() => {
    if (handledWorldviewFilter === null) {
      handledWorldviewFilter = selectedWorldview
      void loadCharacterCards(selectedWorldview)
    }
  })

  onDestroy(() => {
    if (persistSelectedCharacterTimer !== null) {
      clearTimeout(persistSelectedCharacterTimer)
    }
  })

  function normaliseSkillName(value: string): string {
    return value
      .replace(/[①②③④⑤⑥⑦⑧⑨Ω]/gu, '')
      .replace(/[：:（）()／/、，。,.\s-]/gu, '')
      .trim()
  }

  function skillNameMatchesAny(skillName: string, prefixes: string[]): boolean {
    const normalised = normaliseSkillName(skillName)
    return prefixes.some((prefix) => normalised.startsWith(normaliseSkillName(prefix)))
  }

  function getSkillCategoryId(skillName: string): SkillCategoryId {
    if (skillNameMatchesAny(skillName, COMBAT_SKILLS)) {
      return 'combat'
    }

    if (skillNameMatchesAny(skillName, INVESTIGATION_SKILLS)) {
      return 'investigation'
    }

    if (skillNameMatchesAny(skillName, ACADEMIC_SKILLS)) {
      return 'academic'
    }

    if (skillNameMatchesAny(skillName, CRAFT_SKILLS)) {
      return 'craft'
    }

    if (skillNameMatchesAny(skillName, MYTHOS_SKILLS)) {
      return 'mythos'
    }

    if (skillNameMatchesAny(skillName, SOCIAL_SKILLS)) {
      return 'social'
    }

    return 'other'
  }

  function buildFilteredSkillGroups(
    skills: CharacterSheetSkillAllocation[],
    queryText: string,
  ): SkillCategoryGroup[] {
    const query = queryText.trim().toLowerCase()
    const filteredSkills = skills.filter((skill) => {
      if (query === '') {
        return true
      }

      return skill.name.toLowerCase().includes(query)
    })

    return SKILL_CATEGORIES.map((category) => ({
      category,
      skills: filteredSkills.filter((skill) => getSkillCategoryId(skill.name) === category.id),
    })).filter((group) => group.skills.length > 0)
  }

  function updateAttribute(key: CharacterSheetAttributeKey, event: Event): void {
    const nextValue = clampCharacterSheetAttribute(Number((event.currentTarget as HTMLInputElement | null)?.value ?? 0))

    if (selectedCharacterCard) {
      const attributeKey = ATTRIBUTE_KEY_MAP[key]
      const nextAttributes = {
        ...selectedCharacterCard.attributes,
        [attributeKey]: nextValue,
      }

      characterCards = characterCards.map((entry) =>
        entry.id === selectedCharacterCard.id
          ? {
              ...entry,
              attributes: nextAttributes,
              skills: buildSharedCharacterSkills(skillAllocations, mapChatAttributesToCharacterSheet(nextAttributes)),
            }
          : entry,
      )
      queueSelectedCharacterPersist(selectedCharacterCard.id)

      return
    }

    attributes = {
      ...attributes,
      [key]: nextValue,
    }
  }

  function mapChatAttributesToCharacterSheet(attributesValue: ChatCharacterAttributes): CharacterSheetAttributesState {
    return {
      APP: attributesValue.appearance,
      CON: attributesValue.constitution,
      DEX: attributesValue.dexterity,
      EDU: attributesValue.education,
      INT: attributesValue.intelligence,
      LUCK: attributesValue.luck,
      POW: attributesValue.willpower,
      SIZ: attributesValue.size,
      STR: attributesValue.strength,
    }
  }

  function getCurrentAttributes(): CharacterSheetAttributesState {
    return selectedCharacterCard ? mapChatAttributesToCharacterSheet(selectedCharacterCard.attributes) : attributes
  }

  function buildCharacterSelectOptions(cards: ChatCharacterCard[]): CharacterSelectOption[] {
    return cards.map((card) => ({
      id: card.id,
      label: `${card.name}${card.worldview ? ` · ${card.worldview}` : ''}`,
    }))
  }

  function getFilteredCharacterCards(cards: ChatCharacterCard[], worldview: string): ChatCharacterCard[] {
    if (worldview === '') {
      return cards
    }

    return cards.filter((card) => card.worldview === worldview)
  }

  function ensureSelectedWorldview(value: string, options: string[]): string {
    if (value === '' || options.length === 0) {
      return value
    }

    return options.includes(value) ? value : ''
  }

  function getSelectedCharacterId(): string {
    return activeCharacterId ?? ''
  }

  function handleCharacterCardSelect(event: Event): void {
    const nextCharacterId = ((event.currentTarget as HTMLSelectElement | null)?.value ?? '').trim()
    activeCharacterId = nextCharacterId === '' ? null : nextCharacterId
  }

  function getSelectedWorldview(): string {
    return selectedWorldview
  }

  function handleWorldviewChange(event: Event): void {
    const nextValue = ((event.currentTarget as HTMLSelectElement | null)?.value ?? '').trim()

    selectedWorldview = nextValue
  }

  async function loadCharacterCards(worldview: string): Promise<void> {
    isCharacterCardsLoading = true

    try {
      const query = worldview === '' ? '' : `?worldview=${encodeURIComponent(worldview)}`
      const response = await fetch(buildChatHttpUrl(`/character-cards${query}`), {
        cache: 'no-store',
        method: 'GET',
        credentials: 'include',
      })

      let payload: CharacterCardsResponse = { ok: response.ok }

      try {
        payload = (await response.json()) as CharacterCardsResponse
      } catch {
        payload = {
          message: '角色卡服务返回了无法解析的响应。',
          ok: false,
        }
      }

      if (!response.ok || payload.ok === false) {
        characterCards = []
        persistError = payload.message ?? ''
        return
      }

      characterCards = payload.cards ?? []
      persistError = ''
    } catch {
      characterCards = []
    } finally {
      isCharacterCardsLoading = false
    }
  }

  function getSkillAllocationTotal(skill: CharacterSheetSkillAllocation): number {
    return skill.occupationPoints + skill.interestPoints + skill.growthPoints
  }

  function getFieldMaximum(skill: CharacterSheetSkillAllocation, field: SkillPointField): number {
    const otherTotal = getSkillAllocationTotal(skill) - skill[field]
    return Math.max(0, 100 - otherTotal)
  }

  function updateSkillAllocation(
    skillId: string,
    field: SkillPointField,
    event: Event,
  ): void {
    const rawValue = clampCharacterSheetAttribute(
      Number((event.currentTarget as HTMLInputElement | null)?.value ?? 0),
    )

    const nextSkillAllocations = skillAllocations.map((skill) => {
      if (skill.id !== skillId) {
        return skill
      }

      const nextValue = Math.min(rawValue, getFieldMaximum(skill, field))

      return {
        ...skill,
        [field]: nextValue,
      }
    })

    skillAllocations = nextSkillAllocations
    syncSkillsToSelectedCharacter(nextSkillAllocations)
  }

  function resetSkillAllocations(): void {
    const nextSkillAllocations = skillAllocations.map((skill) => ({
      ...skill,
      growthPoints: 0,
      interestPoints: 0,
      occupationPoints: 0,
      name: skill.originalName,
    }))

    skillAllocations = nextSkillAllocations
    syncSkillsToSelectedCharacter(nextSkillAllocations)
  }
  function getSkillTotal(skill: CharacterSheetSkillAllocation): number {
    return (
      resolveBaseSkillValue(skill.name, currentAttributes, skill.baseValue) +
      skill.occupationPoints +
      skill.interestPoints +
      skill.growthPoints
    )
  }

  function isCustomSkill(skill: CharacterSheetSkillAllocation): boolean {
    return skill.originalName === '自定义技能'
  }

  function isSpecialisableSkill(skill: CharacterSheetSkillAllocation): boolean {
    return SPECIALISABLE_SKILL_PATTERN.test(skill.originalName) || skill.originalName === '驾驶：'
  }

  function usesSpecialisedSkillSelect(skill: CharacterSheetSkillAllocation): boolean {
    return SPECIALISED_SKILL_OPTIONS[skill.originalName] !== undefined
  }

  function usesSpecialisedSkillTextInput(skill: CharacterSheetSkillAllocation): boolean {
    return isSpecialisableSkill(skill) && !usesSpecialisedSkillSelect(skill)
  }

  function isEditableSkillName(skill: CharacterSheetSkillAllocation): boolean {
    return isCustomSkill(skill) || isSpecialisableSkill(skill)
  }

  function getSpecialisableSkillRoot(skillName: string): string {
    const matched = /^(技艺|格斗|射击|外语|科学)/u.exec(skillName)

    if (matched) {
      return matched[1]
    }

    if (skillName.startsWith('驾驶')) {
      return '驾驶'
    }

    return skillName
  }

  function buildSpecialisedSkillName(originalName: string, detail: string): string {
    const trimmedDetail = detail.trim()

    if (trimmedDetail === '') {
      return originalName
    }

    return `${getSpecialisableSkillRoot(originalName)}（${trimmedDetail}）`
  }

  function getSpecialisableSkillDefaultDetail(skillName: string): string {
    const parenthesesMatched = /^.+?（(.+?)）$/u.exec(skillName)

    if (parenthesesMatched) {
      return parenthesesMatched[1]
    }

    const matched = /^(技艺|格斗|射击|外语|科学)[①②③④⑤⑥⑦⑧⑨](.+)$/u.exec(skillName)

    if (matched) {
      return matched[2].trim()
    }

    if (skillName.startsWith('驾驶：')) {
      return skillName.slice('驾驶：'.length).trim()
    }

    return ''
  }

  function getEditableSkillNameValue(skill: CharacterSheetSkillAllocation): string {
    if (isCustomSkill(skill)) {
      return skill.name === skill.originalName ? '' : skill.name
    }

    if (!isSpecialisableSkill(skill)) {
      return ''
    }

    if (skill.name === skill.originalName) {
      return getSpecialisableSkillDefaultDetail(skill.originalName)
    }

    if (usesSpecialisedSkillSelect(skill)) {
      return getSpecialisableSkillDefaultDetail(skill.name)
    }

    const parenthesesMatched = /^.+?（(.+?)）$/u.exec(skill.name)

    if (parenthesesMatched) {
      return parenthesesMatched[1]
    }

    return skill.name.replace(getSpecialisableSkillRoot(skill.originalName), '').trim()
  }

  function getEditableSkillNamePlaceholder(skill: CharacterSheetSkillAllocation): string {
    if (isCustomSkill(skill)) {
      return '自定义技能'
    }

    return `自定义${getSpecialisableSkillRoot(skill.originalName)}技能`
  }

  function getSpecialisedSkillOptions(skill: CharacterSheetSkillAllocation): string[] {
    return SPECIALISED_SKILL_OPTIONS[skill.originalName] ?? []
  }

  function sanitiseCustomSkillName(value: string): string {
    return Array.from(value.match(/\p{Script=Han}/gu) ?? []).slice(0, 6).join('')
  }

  function sanitiseSpecialisedSkillName(value: string): string {
    return value
      .replace(/[\r\n\t]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 16)
  }

  function updateCustomSkillName(skillId: string, event: Event): void {
    const currentValue =
      (event.currentTarget as HTMLInputElement | HTMLSelectElement | null)?.value ?? ''

    const nextSkillAllocations = skillAllocations.map((skill) =>
      skill.id === skillId
        ? {
            ...skill,
            name: isCustomSkill(skill)
              ? (() => {
                  const nextValue = sanitiseCustomSkillName(currentValue)
                  return nextValue === '' ? skill.originalName : nextValue
                })()
              : (() => {
                  const nextValue = sanitiseSpecialisedSkillName(currentValue)
                  return buildSpecialisedSkillName(skill.originalName, nextValue)
                })(),
          }
        : skill,
    )

    skillAllocations = nextSkillAllocations
    syncSkillsToSelectedCharacter(nextSkillAllocations)
  }

  function buildDefaultSkillAllocations(): CharacterSheetSkillAllocation[] {
    return characterSheetBaseSkills.map((skill) => ({
      ...skill,
      growthPoints: 0,
      interestPoints: 0,
      occupationPoints: 0,
      originalName: skill.name,
    }))
  }

  function getPersistedSkillIdentity(
    defaultSkill: CharacterSheetSkillAllocation,
    persistedSkill: ChatCharacterSkill,
  ): Pick<CharacterSheetSkillAllocation, 'name' | 'originalName'> {
    if (defaultSkill.id === 'left-39') {
      return {
        name: defaultSkill.name,
        originalName: defaultSkill.originalName,
      }
    }

    const originalName = defaultSkill.originalName
    let name = persistedSkill.name || defaultSkill.name

    if (defaultSkill.id === 'left-40' && name === '射击②') {
      name = defaultSkill.name
    }

    if (defaultSkill.id === 'left-41' && name === '射击③') {
      name = defaultSkill.name
    }

    return {
      name,
      originalName,
    }
  }

  function buildSkillAllocationsFromCharacter(character: ChatCharacterCard | null): CharacterSheetSkillAllocation[] {
    const persistedSkills = new Map((character?.skills ?? []).map((skill) => [skill.id, skill]))

    return buildDefaultSkillAllocations().map((skill) => {
      const persistedSkill = persistedSkills.get(skill.id)

      if (!persistedSkill) {
        return skill
      }

      const persistedIdentity = getPersistedSkillIdentity(skill, persistedSkill)

      return {
        ...skill,
        growthPoints: clampCharacterSheetAttribute(persistedSkill.growthPoints),
        interestPoints: clampCharacterSheetAttribute(persistedSkill.interestPoints),
        name: persistedIdentity.name,
        occupationPoints: clampCharacterSheetAttribute(persistedSkill.occupationPoints),
        originalName: persistedIdentity.originalName,
      }
    })
  }

  function buildSharedCharacterSkills(
    skills: CharacterSheetSkillAllocation[],
    attributeState: CharacterSheetAttributesState = currentAttributes,
  ): ChatCharacterSkill[] {
    return skills.map((skill) => ({
      growthPoints: skill.growthPoints,
      id: skill.id,
      interestPoints: skill.interestPoints,
      name: skill.name,
      occupationPoints: skill.occupationPoints,
      originalName: skill.originalName,
      totalValue:
        resolveBaseSkillValue(skill.name, attributeState, skill.baseValue) +
        skill.occupationPoints +
        skill.interestPoints +
        skill.growthPoints,
    }))
  }

  function syncSkillsToSelectedCharacter(skills: CharacterSheetSkillAllocation[]): void {
    if (!selectedCharacterCard) {
      return
    }

    const nextSkills = buildSharedCharacterSkills(skills)

    characterCards = characterCards.map((entry) =>
      entry.id === selectedCharacterCard.id
        ? {
            ...entry,
            skills: nextSkills,
          }
        : entry,
    )

    queueSelectedCharacterPersist(selectedCharacterCard.id)
  }

  function getCharacterSkillStateKey(character: ChatCharacterCard | null): string {
    return `${character?.id ?? ''}:${JSON.stringify(character?.skills ?? [])}`
  }

  function queueSelectedCharacterPersist(characterId: string): void {
    if (characterId.trim() === '') {
      return
    }

    persistNotice = '修改待保存...'
    persistError = ''

    if (persistSelectedCharacterTimer !== null) {
      clearTimeout(persistSelectedCharacterTimer)
    }

    persistSelectedCharacterTimer = setTimeout(() => {
      persistSelectedCharacterTimer = null
      void persistCharacterCard(characterId)
    }, 400)
  }

  async function persistSelectedCharacterImmediately(): Promise<void> {
    if (!selectedCharacterCard) {
      return
    }

    if (persistSelectedCharacterTimer !== null) {
      clearTimeout(persistSelectedCharacterTimer)
      persistSelectedCharacterTimer = null
    }

    await persistCharacterCard(selectedCharacterCard.id)
  }

  async function persistCharacterCard(characterId: string): Promise<void> {
    const character = characterCards.find((entry) => entry.id === characterId)

    if (!character) {
      return
    }

    const requestToken = ++persistRequestToken
    isPersistingSelectedCharacter = true
    persistError = ''
    persistNotice = '保存中...'

    try {
      const response = await fetch(buildChatHttpUrl(`/character-cards/${encodeURIComponent(characterId)}`), {
        body: JSON.stringify({
          attributes: character.attributes,
          avatarDataUrl: character.avatarDataUrl,
          color: character.color,
          name: character.name,
          presentationMode: character.presentationMode,
          skills: character.skills ?? [],
          worldview: character.worldview,
        }),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'PATCH',
      })

      let payload: CharacterCardSaveResponse = { ok: response.ok }

      try {
        payload = (await response.json()) as CharacterCardSaveResponse
      } catch {
        payload = {
          message: '角色卡服务返回了无法解析的响应。',
          ok: false,
        }
      }

      if (!response.ok || payload.ok === false) {
        persistError = payload.message ?? '角色卡保存失败。'
        persistNotice = ''
        return
      }

      if (payload.card) {
        characterCards = characterCards.map((entry) => (entry.id === payload.card?.id ? payload.card : entry))
      }

      persistNotice = '已保存到角色卡'
    } catch {
      persistError = '角色卡保存失败，请稍后重试。'
      persistNotice = ''
    } finally {
      if (requestToken === persistRequestToken) {
        isPersistingSelectedCharacter = false
      }
    }
  }

  function getOccupationSkillKeywords(skillName: string): string[] {
    const normalised = normaliseSkillName(skillName)
    const genericName = normalised.replace(/\d+$/u, '')
    const keywords = new Set<string>([normalised, genericName])

    if (normalised.startsWith('格斗')) {
      keywords.add('格斗')
      keywords.add('战斗技能')
    }

    if (normalised.startsWith('射击')) {
      keywords.add('射击')
      keywords.add('战斗技能')
    }

    if (normalised.includes('手枪') || normalised.includes('步枪') || normalised.includes('霰弹枪')) {
      keywords.add('射击')
      keywords.add('战斗技能')
    }

    if (normalised.startsWith('技艺')) {
      keywords.add('技艺')
    }

    if (normalised.startsWith('科学')) {
      keywords.add('科学')
    }

    if (normalised.startsWith('外语')) {
      keywords.add('外语')
    }

    if (normalised.startsWith('驾驶')) {
      keywords.add('驾驶')
    }

    for (const alias of OCCUPATION_SKILL_ALIASES[genericName] ?? []) {
      keywords.add(normaliseSkillName(alias))
    }

    return [...keywords].filter(Boolean)
  }

  function isOccupationSkill(skillName: string, occupation: CharacterSheetOccupationData | undefined): boolean {
    if (!occupation) {
      return false
    }

    if (skillName === '信用评级') {
      return true
    }

    const description = normaliseSkillName(occupation.skillsText)

    if (['取悦', '话术', '恐吓', '说服'].includes(skillName)) {
      return description.includes('社交技能') || description.includes(normaliseSkillName(skillName))
    }

    return getOccupationSkillKeywords(skillName).some((keyword) => description.includes(keyword))
  }
</script>

<section class="board character-sheet-page">
  <div class="board-head character-sheet-board-head">
    <div>
      <span class="section-label">工具</span>
      <h2>车卡</h2>
      <p class="board-note">按职业、本职点、兴趣点与成长加点录入；所有技能可自由选择。</p>
    </div>

    <div class="board-head-actions">
      <span class:has-error={persistError !== ''} class="character-sheet-save-state">
        {persistError !== ''
          ? persistError
          : isPersistingSelectedCharacter
            ? '正在保存角色卡...'
            : persistNotice || '修改会自动保存'}
      </span>
      <button
        class="toolbar-action"
        disabled={!selectedCharacterCard || isPersistingSelectedCharacter}
        type="button"
        onclick={() => void persistSelectedCharacterImmediately()}
      >
        保存角色卡
      </button>
      <button class="toolbar-action" type="button" onclick={resetSkillAllocations}>清空技能分配</button>
      <button class="toolbar-action" type="button" onclick={onBack}>返回工具总览</button>
    </div>
  </div>

  <div class="character-sheet-layout">
    <section class="character-sheet-panel character-sheet-form-panel">
      <div class="character-sheet-panel-head">
        <strong>调查员信息</strong>
        <span>基础信息与属性</span>
      </div>

      <div class="character-sheet-field-grid">
        <label>
          <span>角色卡</span>
          <select oninput={handleCharacterCardSelect} value={getSelectedCharacterId()}>
            <option value="">{characterSelectOptions.length > 0 ? '请选择角色卡' : '当前密钥还没有角色卡'}</option>
            {#each characterSelectOptions as option}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>世界观</span>
          <select oninput={handleWorldviewChange} value={getSelectedWorldview()}>
            <option value="">{worldviewOptions.length === 0 ? '暂无世界观' : '全部世界观'}</option>
            {#each worldviewOptions as worldview}
              <option value={worldview}>{worldview}</option>
            {/each}
          </select>
        </label>

        <label class="occupation-field">
          <span>职业</span>
          <select bind:value={selectedOccupationId}>
            {#each characterSheetOccupations as occupation}
              <option value={occupation.id}>{occupation.id}. {occupation.name}</option>
            {/each}
          </select>
        </label>
      </div>

      <div class="character-sheet-attributes-grid">
        {#each ATTRIBUTE_FIELDS as field}
          <label class="character-sheet-attribute-card">
            <span>{field.label}</span>
            <input
              aria-label={field.label}
              max="999"
              min="0"
              oninput={(event) => updateAttribute(field.key, event)}
              type="number"
              value={currentAttributes[field.key]}
            />
            <small>{field.short}</small>
          </label>
        {/each}
      </div>
    </section>

    <aside class="character-sheet-panel character-sheet-occupation-panel">
      <div class="character-sheet-panel-head">
        <strong>{selectedOccupation?.name ?? '未选择职业'}</strong>
        <span>信用评级 {selectedOccupation?.creditRating || '—'}</span>
      </div>

      <div class="character-sheet-stat-strip">
        <article>
          <span>本职</span>
          <strong>{totalOccupationAssigned}/{availableOccupationPoints}</strong>
        </article>
        <article>
          <span>兴趣</span>
          <strong>{totalInterestAssigned}/{derivedStats.interestPoints}</strong>
        </article>
        <article>
          <span>成长</span>
          <strong>{totalGrowthAssigned}</strong>
        </article>
      </div>

      {#if pointBudgetHasWarning}
        <div class="character-sheet-warning">
          点数池已超出：本职剩余 {remainingOccupationPoints}，兴趣剩余 {remainingInterestPoints}
        </div>
      {/if}

      {#if derivedStats.occupationPoints === null}
        <label class="character-sheet-manual-points">
          <span>手动本职点</span>
          <input bind:value={manualOccupationPoints} min="0" type="number" />
        </label>
      {/if}

      <div class="character-sheet-derived-grid">
        <article>
          <span>生命</span>
          <strong>{derivedStats.hitPoints}</strong>
        </article>
        <article>
          <span>魔法</span>
          <strong>{derivedStats.magicPoints}</strong>
        </article>
        <article>
          <span>理智</span>
          <strong>{derivedStats.san}</strong>
        </article>
        <article>
          <span>闪避</span>
          <strong>{derivedStats.dodgeBase}</strong>
        </article>
        <article>
          <span>移动</span>
          <strong>{derivedStats.move}</strong>
        </article>
      </div>

      <div class="character-sheet-info-block">
        <span>本职点公式</span>
        <strong>{selectedOccupation?.pointFormulaText || '—'}</strong>
        <small>{selectedOccupation?.pointFormula || '—'}</small>
      </div>

      <div class="character-sheet-info-block">
        <span>本职技能</span>
        <p>{selectedOccupation?.skillsText || '—'}</p>
      </div>
    </aside>
  </div>

  <section class="character-sheet-panel character-sheet-skills-panel">
    <div class="character-sheet-panel-head skill-panel-head">
      <div>
        <strong>技能分配</strong>
        <span>每项技能的本职、兴趣、成长加点合计最多 100。</span>
      </div>

      <label class="character-sheet-skill-search">
        <span>筛选</span>
        <input bind:value={skillQuery} placeholder="搜索技能名" type="search" />
      </label>
    </div>

    <div class="character-sheet-skill-categories">
      {#each filteredSkillGroups as group (group.category.id)}
        <article class={`character-sheet-skill-category category-${group.category.id}`}>
          <header>
            <div>
              <strong>{group.category.label}</strong>
              <span>{group.category.note}</span>
            </div>
          </header>

          <div class="character-sheet-skill-list">
            <div class="character-sheet-skill-row character-sheet-skill-row-head">
              <span>技能</span>
              <span>基础</span>
              <span>本职</span>
              <span>兴趣</span>
              <span>成长</span>
              <span>总值</span>
            </div>

            {#each group.skills as skill (skill.id)}
              {@const occupationSkill = isOccupationSkill(skill.name, selectedOccupation)}
              {@const editableSkillNameValue = getEditableSkillNameValue(skill)}
              <div class:is-occupation-skill={occupationSkill} class="character-sheet-skill-row">
                <div class="skill-name-cell">
                  {#if isEditableSkillName(skill)}
                    {#if usesSpecialisedSkillSelect(skill)}
                      <CustomSelect
                        ariaLabel={`${skill.originalName} 名称`}
                        className={`skill-name-select${editableSkillNameValue === '' ? ' is-placeholder' : ''}`}
                        placeholder={`${skill.originalName} ▼`}
                        options={getSpecialisedSkillOptions(skill)}
                        value={editableSkillNameValue}
                        oninput={(value) => {
                           const syntheticEvent = { currentTarget: { value } } as unknown as Event;
                           updateCustomSkillName(skill.id, syntheticEvent);
                        }}
                      />
                    {:else}
                      <input
                        aria-label={`${skill.originalName} 名称`}
                        class="skill-name-input"
                        maxlength={isCustomSkill(skill) ? 6 : 16}
                        oninput={(event) => updateCustomSkillName(skill.id, event)}
                        placeholder={getEditableSkillNamePlaceholder(skill)}
                        type="text"
                        value={editableSkillNameValue}
                      />
                    {/if}
                  {:else}
                    <strong>{skill.name}</strong>
                  {/if}
                  {#if occupationSkill}
                    <small>本职</small>
                  {/if}
                </div>
                <span class="skill-number">{resolveBaseSkillValue(skill.name, currentAttributes, skill.baseValue)}</span>
                <input
                  aria-label={`${skill.name} 本职加点`}
                  max={getFieldMaximum(skill, 'occupationPoints')}
                  min="0"
                  oninput={(event) => updateSkillAllocation(skill.id, 'occupationPoints', event)}
                  type="number"
                  value={skill.occupationPoints}
                />
                <input
                  aria-label={`${skill.name} 兴趣加点`}
                  max={getFieldMaximum(skill, 'interestPoints')}
                  min="0"
                  oninput={(event) => updateSkillAllocation(skill.id, 'interestPoints', event)}
                  type="number"
                  value={skill.interestPoints}
                />
                <input
                  aria-label={`${skill.name} 成长加点`}
                  max={getFieldMaximum(skill, 'growthPoints')}
                  min="0"
                  oninput={(event) => updateSkillAllocation(skill.id, 'growthPoints', event)}
                  type="number"
                  value={skill.growthPoints}
                />
                <span class="skill-total">
                  {getSkillTotal(skill)}
                </span>
              </div>
            {/each}
          </div>
        </article>
      {:else}
        <div class="character-sheet-empty">没有匹配的技能。</div>
      {/each}
    </div>
  </section>
</section>

<style>
  .character-sheet-page {
    display: grid;
    gap: 18px;
  }

  .character-sheet-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.02fr) minmax(340px, 0.98fr);
    gap: 16px;
  }

  .character-sheet-panel {
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--panel);
    box-shadow: var(--card-shadow);
    padding: 16px;
  }

  .character-sheet-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 14px;
  }

  .character-sheet-panel-head strong {
    display: block;
    color: var(--text);
    font-size: 1rem;
  }

  .character-sheet-panel-head span {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .character-sheet-field-grid,
  .character-sheet-attributes-grid,
  .character-sheet-stat-strip,
  .character-sheet-derived-grid {
    display: grid;
    gap: 10px;
  }

  .character-sheet-field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: 12px;
  }

  .character-sheet-attributes-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .character-sheet-form-panel {
    max-width: 720px;
  }

  .occupation-field {
    grid-column: 1 / -1;
  }

  .character-sheet-attribute-card,
  .character-sheet-info-block,
  .character-sheet-stat-strip article,
  .character-sheet-derived-grid article {
    display: grid;
    gap: 5px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--panel-strong);
  }

  .character-sheet-attribute-card {
    align-content: start;
  }

  .character-sheet-attribute-card span,
  .character-sheet-stat-strip span,
  .character-sheet-derived-grid span,
  .character-sheet-info-block span,
  .character-sheet-manual-points span,
  .character-sheet-skill-search span {
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1;
  }

  .character-sheet-attribute-card small {
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1;
    text-align: center;
  }

  .character-sheet-stat-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-bottom: 10px;
  }

  .character-sheet-derived-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin: 10px 0;
  }

  .character-sheet-stat-strip strong,
  .character-sheet-derived-grid strong,
  .character-sheet-info-block strong {
    color: var(--text);
    font-size: 0.94rem;
    line-height: 1.1;
  }

  .character-sheet-info-block {
    margin-top: 10px;
  }

  .character-sheet-info-block small,
  .character-sheet-info-block p {
    margin: 0;
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.46;
    white-space: pre-wrap;
  }

  .character-sheet-manual-points {
    display: grid;
    gap: 6px;
    margin: 10px 0;
  }

  .character-sheet-warning {
    margin-bottom: 10px;
    padding: 9px 10px;
    border: 1px solid rgba(190, 113, 108, 0.34);
    border-radius: 10px;
    background: rgba(255, 244, 243, 0.88);
    color: #8a3c35;
    font-size: 0.76rem;
    line-height: 1.35;
  }

  label {
    display: grid;
    gap: 5px;
  }

  label > span {
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1;
  }

  input,
  select {
    width: 100%;
    min-width: 0;
    min-height: 34px;
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 0.45rem 0.58rem;
    background: var(--panel-strong);
    color: var(--text);
    font: inherit;
    font-size: 0.84rem;
  }

  select {
    padding-right: 2.2rem;
  }

  .character-sheet-attribute-card input {
    padding-inline: 0.34rem;
    text-align: center;
  }

  .character-sheet-skills-panel {
    overflow: visible;
  }

  .skill-panel-head {
    align-items: end;
  }

  .character-sheet-skill-search {
    width: min(240px, 100%);
  }

  .character-sheet-skill-categories {
    column-count: 2;
    column-gap: 14px;
    overflow: visible;
  }

  .character-sheet-skill-category {
    --category-color: #6b7280;
    --category-surface: rgba(107, 114, 128, 0.1);

    display: inline-block;
    position: relative;
    width: 100%;
    margin: 0 0 14px;
    break-inside: avoid;
    overflow: visible;
    border: 1px solid color-mix(in srgb, var(--category-color) 28%, var(--line));
    border-radius: 14px;
    background: var(--panel-strong);
  }

  .character-sheet-skill-category.category-combat {
    --category-color: #b45309;
    --category-surface: rgba(180, 83, 9, 0.12);
  }

  .character-sheet-skill-category.category-investigation {
    --category-color: #2563eb;
    --category-surface: rgba(37, 99, 235, 0.1);
  }

  .character-sheet-skill-category.category-academic {
    --category-color: #7c3aed;
    --category-surface: rgba(124, 58, 237, 0.1);
  }

  .character-sheet-skill-category.category-social {
    --category-color: #0f766e;
    --category-surface: rgba(15, 118, 110, 0.12);
  }

  .character-sheet-skill-category.category-craft {
    --category-color: #c2410c;
    --category-surface: rgba(194, 65, 12, 0.11);
  }

  .character-sheet-skill-category.category-mythos {
    --category-color: #b91c1c;
    --category-surface: rgba(185, 28, 28, 0.12);
  }

  .character-sheet-skill-category.category-other {
    --category-color: #64748b;
    --category-surface: rgba(100, 116, 139, 0.11);
  }

  .character-sheet-skill-category header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 13px 13px 0 0;
    background: color-mix(in srgb, var(--category-color) 14%, var(--panel-strong));
    border-bottom: 1px solid color-mix(in srgb, var(--category-color) 24%, var(--line));
  }

  .character-sheet-skill-category header strong {
    display: block;
    color: color-mix(in srgb, var(--category-color) 72%, var(--text));
    font-size: 0.92rem;
    line-height: 1.1;
  }

  .character-sheet-skill-category header span {
    display: block;
    margin-top: 3px;
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.28;
  }

  .character-sheet-skill-list {
    display: grid;
    gap: 0;
  }

  .character-sheet-skill-row {
    display: grid;
    position: relative;
    grid-template-columns: minmax(112px, 1fr) 42px repeat(3, 54px) 54px;
    gap: 7px;
    align-items: center;
    padding: 7px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 72%, transparent);
  }

  .character-sheet-skill-row:focus-within {
    z-index: 2000;
  }

  .character-sheet-skill-row:last-child {
    border-bottom: none;
  }

  .character-sheet-skill-row-head {
    padding-top: 8px;
    padding-bottom: 6px;
    background: rgba(255, 255, 255, 0.42);
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 700;
  }

  .character-sheet-skill-row-head > span {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    text-align: center;
  }

  .character-sheet-skill-row-head > span:first-child {
    justify-content: flex-start;
    text-align: left;
  }

  .character-sheet-skill-row.is-occupation-skill {
    background: var(--category-surface);
  }

  .skill-name-cell {
    --skill-name-font-size: 0.8rem;
    --skill-name-font-weight: 500;
    --skill-name-line-height: 1.2;

    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text);
    font-family: var(--font-body);
  }

  .skill-name-cell strong {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-family: inherit;
    font-size: var(--skill-name-font-size);
    font-weight: var(--skill-name-font-weight);
    line-height: var(--skill-name-line-height);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skill-name-input {
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 28px;
    padding: 0.18rem 0.4rem 0.18rem 0;
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    font-family: inherit;
    font-size: var(--skill-name-font-size);
    font-weight: var(--skill-name-font-weight);
    line-height: var(--skill-name-line-height);
    text-align: left !important;
    color: var(--text);
  }

  .skill-name-input::placeholder {
    color: var(--muted);
    opacity: 1;
  }

  :global(.skill-name-select) {
    display: inline-flex;
    align-items: center;
    position: relative;
    z-index: 20;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 28px;
    color: var(--text);
    font-family: inherit;
  }

  :global(.skill-name-select .custom-select-trigger),
  :global(.skill-name-select .custom-select-value) {
    min-width: 0;
    width: 100%;
    border: none !important;
    background-color: transparent !important;
    box-shadow: none !important;
    color: inherit !important;
    font-family: inherit !important;
    font-size: var(--skill-name-font-size) !important;
    font-weight: var(--skill-name-font-weight) !important;
    line-height: var(--skill-name-line-height) !important;
    text-align: left !important;
  }

  :global(.skill-name-select .custom-select-trigger) {
    padding: 0.18rem 1.35rem 0.18rem 0 !important;
  }

  :global(.skill-name-select .custom-select-value) {
    display: block !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  :global(.skill-name-select.is-placeholder) {
    color: var(--muted);
  }

  :global(.skill-name-select .custom-select-menu) {
    z-index: 1000;
  }

  .skill-name-cell small {
    flex: none;
    padding: 0.12rem 0.34rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--category-color) 18%, transparent);
    color: color-mix(in srgb, var(--category-color) 82%, var(--text));
    font-size: 0.64rem;
    font-weight: 700;
    line-height: 1.15;
  }

  .skill-number,
  .skill-total {
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 700;
    text-align: center;
  }

  .skill-total {
    display: block;
  }

  .character-sheet-skill-row input {
    min-height: 30px;
    padding: 0.3rem 0.32rem;
    text-align: center;
  }

  .character-sheet-empty {
    grid-column: 1 / -1;
    padding: 18px;
    border: 1px dashed var(--line);
    border-radius: 14px;
    color: var(--muted);
    font-size: 0.86rem;
  }

  @media (max-width: 1240px) {
    .character-sheet-attributes-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .character-sheet-form-panel {
      max-width: none;
    }
  }

  @media (max-width: 1100px) {
    .character-sheet-layout {
      grid-template-columns: 1fr;
    }

    .character-sheet-skill-categories {
      column-count: 1;
    }
  }

  @media (max-width: 720px) {
    .character-sheet-field-grid,
    .character-sheet-stat-strip,
    .character-sheet-derived-grid,
    .character-sheet-attributes-grid {
      grid-template-columns: 1fr;
    }

    .occupation-field {
      grid-column: auto;
    }

    .character-sheet-panel-head,
    .skill-panel-head {
      flex-direction: column;
      align-items: stretch;
    }

    .character-sheet-skill-search {
      width: 100%;
    }

    .character-sheet-skill-row {
      grid-template-columns: minmax(92px, 1fr) 36px repeat(3, 46px) 48px;
      gap: 5px;
      padding-inline: 8px;
    }
  }
</style>

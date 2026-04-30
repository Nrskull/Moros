export type CharacterSheetAttributeKey =
  | 'STR'
  | 'CON'
  | 'SIZ'
  | 'DEX'
  | 'APP'
  | 'INT'
  | 'POW'
  | 'EDU'
  | 'LUCK'

export interface CharacterSheetAttributes {
  STR: number
  CON: number
  SIZ: number
  DEX: number
  APP: number
  INT: number
  POW: number
  EDU: number
  LUCK: number
}

export interface CharacterSheetDerivedStats {
  dodgeBase: number
  hitPoints: number
  ideaPoints: number
  interestPoints: number
  magicPoints: number
  move: number
  occupationPoints: number | null
  san: number
}

type Token =
  | { type: 'identifier'; value: string }
  | { type: 'number'; value: number }
  | { type: 'symbol'; value: '(' | ')' | '+' | '*' | ',' }

const FORMULA_IDENTIFIER = /^[A-Z]+$/u

function tokenizeFormula(input: string): Token[] {
  const source = input.replace(/\s+/gu, '')
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (char === '(' || char === ')' || char === '+' || char === '*' || char === ',') {
      tokens.push({ type: 'symbol', value: char })
      index += 1
      continue
    }

    if (/\d/u.test(char)) {
      let end = index + 1

      while (end < source.length && /\d/u.test(source[end])) {
        end += 1
      }

      tokens.push({ type: 'number', value: Number(source.slice(index, end)) })
      index = end
      continue
    }

    if (/[A-Z]/u.test(char)) {
      let end = index + 1

      while (end < source.length && /[A-Z]/u.test(source[end])) {
        end += 1
      }

      tokens.push({ type: 'identifier', value: source.slice(index, end) })
      index = end
      continue
    }

    throw new Error(`Unsupported token in formula: ${char}`)
  }

  return tokens
}

function parseFormula(formula: string, attributes: CharacterSheetAttributes): number {
  const tokens = tokenizeFormula(formula)
  let index = 0

  function readExpression(): number {
    let value = readTerm()

    while (tokens[index]?.type === 'symbol' && tokens[index].value === '+') {
      index += 1
      value += readTerm()
    }

    return value
  }

  function readTerm(): number {
    let value = readFactor()

    while (tokens[index]?.type === 'symbol' && tokens[index].value === '*') {
      index += 1
      value *= readFactor()
    }

    return value
  }

  function readFactor(): number {
    const token = tokens[index]

    if (!token) {
      throw new Error('Unexpected end of formula')
    }

    if (token.type === 'number') {
      index += 1
      return token.value
    }

    if (token.type === 'identifier') {
      index += 1

      if (token.value === 'MAX') {
        expectSymbol('(')
        const values = [readExpression()]

        while (tokens[index]?.type === 'symbol' && tokens[index].value === ',') {
          index += 1
          values.push(readExpression())
        }

        expectSymbol(')')
        return Math.max(...values)
      }

      if (!FORMULA_IDENTIFIER.test(token.value)) {
        throw new Error(`Unsupported identifier: ${token.value}`)
      }

      return attributes[token.value as CharacterSheetAttributeKey] ?? 0
    }

    if (token.type === 'symbol' && token.value === '(') {
      index += 1
      const value = readExpression()
      expectSymbol(')')
      return value
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`)
  }

  function expectSymbol(symbol: '(' | ')' | '+' | '*' | ','): void {
    const token = tokens[index]

    if (!token || token.type !== 'symbol' || token.value !== symbol) {
      throw new Error(`Expected symbol ${symbol}`)
    }

    index += 1
  }

  const value = readExpression()

  if (index !== tokens.length) {
    throw new Error('Formula parsing did not consume all tokens')
  }

  return value
}

export function createDefaultCharacterSheetAttributes(): CharacterSheetAttributes {
  return {
    APP: 50,
    CON: 50,
    DEX: 50,
    EDU: 50,
    INT: 50,
    LUCK: 50,
    POW: 50,
    SIZ: 50,
    STR: 50,
  }
}

export function clampCharacterSheetAttribute(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(999, Math.floor(value)))
}

export function evaluateOccupationPoints(
  formula: string,
  attributes: CharacterSheetAttributes,
): number | null {
  const trimmedFormula = formula.trim()

  if (trimmedFormula === '' || trimmedFormula.startsWith('SUM(')) {
    return null
  }

  try {
    return parseFormula(trimmedFormula, attributes)
  } catch {
    return null
  }
}

export function resolveBaseSkillValue(skillName: string, attributes: CharacterSheetAttributes, fallback: number): number {
  if (skillName === '闪避') {
    return Math.floor(attributes.DEX / 2)
  }

  if (skillName === '母语') {
    return attributes.EDU
  }

  return fallback
}

export function calculateMove(attributes: CharacterSheetAttributes): number {
  const { DEX, STR, SIZ } = attributes

  if (DEX < SIZ && STR < SIZ) {
    return 7
  }

  if (DEX > SIZ && STR > SIZ) {
    return 9
  }

  return 8
}

export function calculateDerivedStats(
  attributes: CharacterSheetAttributes,
  occupationFormula: string,
): CharacterSheetDerivedStats {
  return {
    dodgeBase: Math.floor(attributes.DEX / 2),
    hitPoints: Math.floor((attributes.CON + attributes.SIZ) / 10),
    ideaPoints: Math.floor(attributes.INT / 2),
    interestPoints: attributes.INT * 2,
    magicPoints: Math.floor(attributes.POW / 5),
    move: calculateMove(attributes),
    occupationPoints: evaluateOccupationPoints(occupationFormula, attributes),
    san: attributes.POW,
  }
}
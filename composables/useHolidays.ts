// composables/useHolidays.ts
// Comprehensive Japanese and Korean holiday calculator

export interface Holiday {
  date: string // YYYY-MM-DD
  name: string
  nameJa: string
  nameKo: string
  country: 'jp' | 'kr' | 'both'
  type: 'national' | 'traditional' | 'observance'
}

// ============ HELPER FUNCTIONS ============

// Get nth weekday of month (e.g., 2nd Monday)
// weekday: 0=Sunday, 1=Monday, ..., 6=Saturday
const getNthWeekday = (year: number, month: number, weekday: number, n: number): number => {
  const firstDay = new Date(year, month, 1)
  const firstWeekday = firstDay.getDay()
  let day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7
  return day
}

// Format date as YYYY-MM-DD
const formatDate = (year: number, month: number, day: number): string => {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Add days to a date string
const addDays = (dateString: string, days: number): string => {
  const [year, month, day] = dateString.split('-').map(Number)
  const date = new Date(year, month - 1, day + days)
  return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

// ============ EQUINOX CALCULATIONS (Accurate to ±1 day) ============

// Calculate Vernal Equinox Day for Japan (around March 20-21)
const getVernalEquinox = (year: number): number => {
  // Improved formula based on astronomical calculations
  if (year >= 1900 && year <= 2099) {
    const y = year - 1980
    return Math.floor(20.8431 + 0.242194 * y - Math.floor(y / 4))
  }
  // Fallback for other years
  return 20
}

// Calculate Autumnal Equinox Day for Japan (around September 22-23)
const getAutumnalEquinox = (year: number): number => {
  // Improved formula based on astronomical calculations
  if (year >= 1900 && year <= 2099) {
    const y = year - 1980
    return Math.floor(23.2488 + 0.242194 * y - Math.floor(y / 4))
  }
  // Fallback for other years
  return 23
}

// ============ LUNAR CALENDAR CALCULATIONS ============

// Extended lunar new year dates (Seollal) - 2020 to 2040
const LUNAR_NEW_YEAR_DATES: Record<number, string> = {
  2020: '2020-01-25',
  2021: '2021-02-12',
  2022: '2022-02-01',
  2023: '2023-01-22',
  2024: '2024-02-10',
  2025: '2025-01-29',
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
  2029: '2029-02-13',
  2030: '2030-02-03',
  2031: '2031-01-23',
  2032: '2032-02-11',
  2033: '2033-01-31',
  2034: '2034-02-19',
  2035: '2035-02-08',
  2036: '2036-01-28',
  2037: '2037-02-15',
  2038: '2038-02-04',
  2039: '2039-01-24',
  2040: '2040-02-12',
}

// Extended Chuseok dates (Korean Thanksgiving, Lunar 8/15) - 2020 to 2040
const CHUSEOK_DATES: Record<number, string> = {
  2020: '2020-10-01',
  2021: '2021-09-21',
  2022: '2022-09-10',
  2023: '2023-09-29',
  2024: '2024-09-17',
  2025: '2025-10-06',
  2026: '2026-09-25',
  2027: '2027-09-15',
  2028: '2028-10-03',
  2029: '2029-09-22',
  2030: '2030-09-12',
  2031: '2031-10-01',
  2032: '2032-09-19',
  2033: '2033-09-08',
  2034: '2034-09-27',
  2035: '2035-09-16',
  2036: '2036-10-04',
  2037: '2037-09-24',
  2038: '2038-09-13',
  2039: '2039-10-02',
  2040: '2040-09-21',
}

// Extended Buddha's Birthday dates (Korean, Lunar 4/8) - 2020 to 2040
const BUDDHAS_BIRTHDAY_DATES: Record<number, string> = {
  2020: '2020-04-30',
  2021: '2021-05-19',
  2022: '2022-05-08',
  2023: '2023-05-27',
  2024: '2024-05-15',
  2025: '2025-05-05',
  2026: '2026-05-24',
  2027: '2027-05-13',
  2028: '2028-05-02',
  2029: '2029-05-20',
  2030: '2030-05-09',
  2031: '2031-05-28',
  2032: '2032-05-16',
  2033: '2033-05-06',
  2034: '2034-05-25',
  2035: '2035-05-15',
  2036: '2036-05-03',
  2037: '2037-05-22',
  2038: '2038-05-11',
  2039: '2039-04-30',
  2040: '2040-05-18',
}

// Approximate lunar date calculation for years outside the lookup table
// This uses a simplified algorithm and may be off by 1-2 days
const approximateLunarNewYear = (year: number): string => {
  // Lunar New Year falls between Jan 21 and Feb 20
  // Average cycle is about 29.5 days, and the date shifts by about 11 days each year
  const baseYear = 2020
  const baseDate = new Date(2020, 0, 25) // Jan 25, 2020

  let diff = year - baseYear
  let days = diff * 354.37 // Average lunar year
  days = days % 365.25 // Keep within a year

  const approxDate = new Date(year, 0, 21 + Math.floor(days % 30))

  // Clamp to valid range
  if (approxDate.getMonth() === 0 && approxDate.getDate() < 21) {
    approxDate.setDate(21)
  }
  if (approxDate.getMonth() > 1 || (approxDate.getMonth() === 1 && approxDate.getDate() > 20)) {
    approxDate.setMonth(1)
    approxDate.setDate(15)
  }

  return formatDate(approxDate.getFullYear(), approxDate.getMonth() + 1, approxDate.getDate())
}

const getLunarNewYear = (year: number): string => {
  return LUNAR_NEW_YEAR_DATES[year] || approximateLunarNewYear(year)
}

const getChuseok = (year: number): string => {
  if (CHUSEOK_DATES[year]) return CHUSEOK_DATES[year]
  // Approximate: Chuseok is about 8 lunar months after Lunar New Year
  // Roughly around mid-September to early October
  return `${year}-09-20`
}

const getBuddhasBirthday = (year: number): string => {
  if (BUDDHAS_BIRTHDAY_DATES[year]) return BUDDHAS_BIRTHDAY_DATES[year]
  // Approximate: usually in May
  return `${year}-05-15`
}

// ============ JAPANESE SUBSTITUTE HOLIDAY LOGIC ============

// In Japan, if a national holiday falls on Sunday, the next Monday is a substitute holiday
const getSubstituteHoliday = (year: number, month: number, day: number): { date: string; applies: boolean } => {
  const date = new Date(year, month - 1, day)
  const dayOfWeek = date.getDay()

  if (dayOfWeek === 0) { // Sunday
    return {
      date: formatDate(year, month, day + 1),
      applies: true
    }
  }
  return { date: '', applies: false }
}

// ============ MAIN HOLIDAY GENERATOR ============

export const useHolidays = () => {
  const getHolidaysForYear = (year: number): Holiday[] => {
    const holidays: Holiday[] = []
    const addedDates = new Set<string>() // Track dates to avoid duplicates

    const addHoliday = (holiday: Holiday) => {
      const key = `${holiday.date}-${holiday.country}`
      if (!addedDates.has(key)) {
        addedDates.add(key)
        holidays.push(holiday)
      }
    }

    // ============ JAPANESE HOLIDAYS ============

    // New Year's Day - 元日 (January 1) - Both JP and KR
    addHoliday({
      date: formatDate(year, 1, 1),
      name: "New Year's Day",
      nameJa: '元日',
      nameKo: '신정',
      country: 'both',
      type: 'national'
    })

    // Coming of Age Day - 成人の日 (2nd Monday of January)
    const comingOfAgeDay = getNthWeekday(year, 0, 1, 2)
    addHoliday({
      date: formatDate(year, 1, comingOfAgeDay),
      name: 'Coming of Age Day',
      nameJa: '成人の日',
      nameKo: '성인의 날',
      country: 'jp',
      type: 'national'
    })

    // National Foundation Day - 建国記念の日 (February 11)
    addHoliday({
      date: formatDate(year, 2, 11),
      name: 'National Foundation Day',
      nameJa: '建国記念の日',
      nameKo: '건국기념일 (일본)',
      country: 'jp',
      type: 'national'
    })
    // Substitute holiday check
    const nfdSub = getSubstituteHoliday(year, 2, 11)
    if (nfdSub.applies) {
      addHoliday({
        date: nfdSub.date,
        name: 'Substitute Holiday',
        nameJa: '振替休日',
        nameKo: '대체휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // Emperor's Birthday - 天皇誕生日 (February 23)
    addHoliday({
      date: formatDate(year, 2, 23),
      name: "Emperor's Birthday",
      nameJa: '天皇誕生日',
      nameKo: '천황 탄생일',
      country: 'jp',
      type: 'national'
    })
    const ebSub = getSubstituteHoliday(year, 2, 23)
    if (ebSub.applies) {
      addHoliday({
        date: ebSub.date,
        name: 'Substitute Holiday',
        nameJa: '振替休日',
        nameKo: '대체휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // Vernal Equinox Day - 春分の日 (around March 20-21)
    const vernalEquinox = getVernalEquinox(year)
    addHoliday({
      date: formatDate(year, 3, vernalEquinox),
      name: 'Vernal Equinox Day',
      nameJa: '春分の日',
      nameKo: '춘분',
      country: 'jp',
      type: 'national'
    })

    // Showa Day - 昭和の日 (April 29)
    addHoliday({
      date: formatDate(year, 4, 29),
      name: 'Showa Day',
      nameJa: '昭和の日',
      nameKo: '쇼와의 날',
      country: 'jp',
      type: 'national'
    })

    // Constitution Memorial Day - 憲法記念日 (May 3)
    addHoliday({
      date: formatDate(year, 5, 3),
      name: 'Constitution Memorial Day',
      nameJa: '憲法記念日',
      nameKo: '헌법기념일 (일본)',
      country: 'jp',
      type: 'national'
    })

    // Greenery Day - みどりの日 (May 4)
    addHoliday({
      date: formatDate(year, 5, 4),
      name: 'Greenery Day',
      nameJa: 'みどりの日',
      nameKo: '녹색의 날',
      country: 'jp',
      type: 'national'
    })

    // Children's Day - こどもの日 (May 5) - Both JP and KR
    addHoliday({
      date: formatDate(year, 5, 5),
      name: "Children's Day",
      nameJa: 'こどもの日',
      nameKo: '어린이날',
      country: 'both',
      type: 'national'
    })
    // May 6 substitute if May 3, 4, or 5 falls on Sunday
    const may3Day = new Date(year, 4, 3).getDay()
    const may4Day = new Date(year, 4, 4).getDay()
    const may5Day = new Date(year, 4, 5).getDay()
    if (may3Day === 0 || may4Day === 0 || may5Day === 0) {
      addHoliday({
        date: formatDate(year, 5, 6),
        name: 'Substitute Holiday',
        nameJa: '振替休日',
        nameKo: '대체휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // Marine Day - 海の日 (3rd Monday of July)
    const marineDay = getNthWeekday(year, 6, 1, 3)
    addHoliday({
      date: formatDate(year, 7, marineDay),
      name: 'Marine Day',
      nameJa: '海の日',
      nameKo: '바다의 날',
      country: 'jp',
      type: 'national'
    })

    // Mountain Day - 山の日 (August 11)
    addHoliday({
      date: formatDate(year, 8, 11),
      name: 'Mountain Day',
      nameJa: '山の日',
      nameKo: '산의 날',
      country: 'jp',
      type: 'national'
    })
    const mdSub = getSubstituteHoliday(year, 8, 11)
    if (mdSub.applies) {
      addHoliday({
        date: mdSub.date,
        name: 'Substitute Holiday',
        nameJa: '振替休日',
        nameKo: '대체휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // Respect for the Aged Day - 敬老の日 (3rd Monday of September)
    const respectAgedDay = getNthWeekday(year, 8, 1, 3)
    addHoliday({
      date: formatDate(year, 9, respectAgedDay),
      name: 'Respect for the Aged Day',
      nameJa: '敬老の日',
      nameKo: '경로의 날',
      country: 'jp',
      type: 'national'
    })

    // Autumnal Equinox Day - 秋分の日 (around September 22-23)
    const autumnalEquinox = getAutumnalEquinox(year)
    addHoliday({
      date: formatDate(year, 9, autumnalEquinox),
      name: 'Autumnal Equinox Day',
      nameJa: '秋分の日',
      nameKo: '추분',
      country: 'jp',
      type: 'national'
    })

    // Check for "Sandwich Day" - if a day is between two holidays, it becomes a holiday
    // This can happen between Respect for Aged Day and Autumnal Equinox
    if (autumnalEquinox - respectAgedDay === 2) {
      addHoliday({
        date: formatDate(year, 9, respectAgedDay + 1),
        name: 'Citizens Holiday',
        nameJa: '国民の休日',
        nameKo: '국민의 휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // Sports Day - スポーツの日 (2nd Monday of October)
    const sportsDay = getNthWeekday(year, 9, 1, 2)
    addHoliday({
      date: formatDate(year, 10, sportsDay),
      name: 'Sports Day',
      nameJa: 'スポーツの日',
      nameKo: '체육의 날',
      country: 'jp',
      type: 'national'
    })

    // Culture Day - 文化の日 (November 3)
    addHoliday({
      date: formatDate(year, 11, 3),
      name: 'Culture Day',
      nameJa: '文化の日',
      nameKo: '문화의 날',
      country: 'jp',
      type: 'national'
    })
    const cdSub = getSubstituteHoliday(year, 11, 3)
    if (cdSub.applies) {
      addHoliday({
        date: cdSub.date,
        name: 'Substitute Holiday',
        nameJa: '振替休日',
        nameKo: '대체휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // Labour Thanksgiving Day - 勤労感謝の日 (November 23)
    addHoliday({
      date: formatDate(year, 11, 23),
      name: 'Labour Thanksgiving Day',
      nameJa: '勤労感謝の日',
      nameKo: '근로감사의 날',
      country: 'jp',
      type: 'national'
    })
    const ltdSub = getSubstituteHoliday(year, 11, 23)
    if (ltdSub.applies) {
      addHoliday({
        date: ltdSub.date,
        name: 'Substitute Holiday',
        nameJa: '振替休日',
        nameKo: '대체휴일',
        country: 'jp',
        type: 'national'
      })
    }

    // ============ KOREAN HOLIDAYS ============

    // Seollal (Lunar New Year) - 설날 (3 days: day before, day of, day after)
    const seollal = getLunarNewYear(year)
    addHoliday({
      date: addDays(seollal, -1),
      name: 'Seollal Eve',
      nameJa: '旧正月前日',
      nameKo: '설날 연휴',
      country: 'kr',
      type: 'national'
    })
    addHoliday({
      date: seollal,
      name: 'Seollal (Lunar New Year)',
      nameJa: '旧正月',
      nameKo: '설날',
      country: 'kr',
      type: 'national'
    })
    addHoliday({
      date: addDays(seollal, 1),
      name: 'Seollal Holiday',
      nameJa: '旧正月翌日',
      nameKo: '설날 연휴',
      country: 'kr',
      type: 'national'
    })

    // Independence Movement Day - 삼일절 (March 1)
    addHoliday({
      date: formatDate(year, 3, 1),
      name: 'Independence Movement Day',
      nameJa: '三一節',
      nameKo: '삼일절',
      country: 'kr',
      type: 'national'
    })

    // Buddha's Birthday - 부처님 오신 날 (Lunar April 8)
    const buddhasBirthday = getBuddhasBirthday(year)
    addHoliday({
      date: buddhasBirthday,
      name: "Buddha's Birthday",
      nameJa: '釈迦誕生日',
      nameKo: '부처님 오신 날',
      country: 'kr',
      type: 'national'
    })

    // Memorial Day - 현충일 (June 6)
    addHoliday({
      date: formatDate(year, 6, 6),
      name: 'Memorial Day',
      nameJa: '顕忠日',
      nameKo: '현충일',
      country: 'kr',
      type: 'national'
    })

    // Liberation Day - 광복절 (August 15) - Both JP and KR
    addHoliday({
      date: formatDate(year, 8, 15),
      name: 'Liberation Day',
      nameJa: '終戦記念日',
      nameKo: '광복절',
      country: 'kr',
      type: 'national'
    })
    // Also add as Japanese memorial day
    addHoliday({
      date: formatDate(year, 8, 15),
      name: 'End of War Memorial Day',
      nameJa: '終戦記念日',
      nameKo: '종전기념일',
      country: 'jp',
      type: 'observance'
    })

    // Chuseok - 추석 (3 days: day before, day of, day after)
    const chuseok = getChuseok(year)
    addHoliday({
      date: addDays(chuseok, -1),
      name: 'Chuseok Eve',
      nameJa: '秋夕前日',
      nameKo: '추석 연휴',
      country: 'kr',
      type: 'national'
    })
    addHoliday({
      date: chuseok,
      name: 'Chuseok',
      nameJa: '秋夕',
      nameKo: '추석',
      country: 'kr',
      type: 'national'
    })
    addHoliday({
      date: addDays(chuseok, 1),
      name: 'Chuseok Holiday',
      nameJa: '秋夕翌日',
      nameKo: '추석 연휴',
      country: 'kr',
      type: 'national'
    })

    // National Foundation Day (Korea) - 개천절 (October 3)
    addHoliday({
      date: formatDate(year, 10, 3),
      name: 'National Foundation Day',
      nameJa: '開天節',
      nameKo: '개천절',
      country: 'kr',
      type: 'national'
    })

    // Hangeul Day - 한글날 (October 9)
    addHoliday({
      date: formatDate(year, 10, 9),
      name: 'Hangeul Day',
      nameJa: 'ハングルの日',
      nameKo: '한글날',
      country: 'kr',
      type: 'national'
    })

    // Christmas - 크리스마스 (December 25) - Holiday in Korea, not in Japan
    addHoliday({
      date: formatDate(year, 12, 25),
      name: 'Christmas',
      nameJa: 'クリスマス',
      nameKo: '크리스마스',
      country: 'kr',
      type: 'national'
    })

    // Sort holidays by date
    holidays.sort((a, b) => a.date.localeCompare(b.date))

    return holidays
  }

  const getHolidaysForMonth = (year: number, month: number): Holiday[] => {
    const allHolidays = getHolidaysForYear(year)
    const monthStr = String(month).padStart(2, '0')
    return allHolidays.filter(h => h.date.startsWith(`${year}-${monthStr}`))
  }

  const getHolidayForDate = (dateString: string): Holiday[] => {
    const year = parseInt(dateString.split('-')[0])
    const allHolidays = getHolidaysForYear(year)
    return allHolidays.filter(h => h.date === dateString)
  }

  const isHoliday = (dateString: string): boolean => {
    return getHolidayForDate(dateString).length > 0
  }

  const isJapaneseHoliday = (dateString: string): boolean => {
    const holidays = getHolidayForDate(dateString)
    return holidays.some(h => h.country === 'jp' || h.country === 'both')
  }

  const isKoreanHoliday = (dateString: string): boolean => {
    const holidays = getHolidayForDate(dateString)
    return holidays.some(h => h.country === 'kr' || h.country === 'both')
  }

  const getHolidayName = (dateString: string, locale: string): string | null => {
    const holidays = getHolidayForDate(dateString)
    if (holidays.length === 0) return null

    const holiday = holidays[0]
    return locale === 'ko' ? holiday.nameKo : holiday.nameJa
  }

  return {
    getHolidaysForYear,
    getHolidaysForMonth,
    getHolidayForDate,
    isHoliday,
    isJapaneseHoliday,
    isKoreanHoliday,
    getHolidayName
  }
}

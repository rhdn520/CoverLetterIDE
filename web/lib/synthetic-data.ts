export interface SyntheticEssay {
  id: string
  major: string
  experienceYears: number
  result: "passed" | "failed"
  similarity: number
}

/**
 * 실제 지원자 데이터 없이 검색·재정렬 화면을 검증하기 위한 고정 데이터다.
 * 배열 생성식이 입력과 무관하게 항상 같아서 테스트와 목업 결과가 흔들리지 않는다.
 */
export function createSyntheticEssays(): SyntheticEssay[] {
  const majors = ["경영학", "컴퓨터공학", "산업공학", "통계학", "미디어학"]
  return Array.from({ length: 30 }, (_, index) => ({
    id: `synthetic-${index + 1}`,
    major: majors[index % majors.length],
    experienceYears: (index % 4) + 1,
    result: index % 3 === 0 || index % 5 === 0 ? "failed" : "passed",
    similarity: 0.96 - index * 0.012,
  }))
}

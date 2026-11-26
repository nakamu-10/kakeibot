/**
 * 日本の祝日（holidays-jp）。振替休日・国民の休日を含み、節分などの祝日でない日は含まない。
 * 年ごとのデータは数年先まである。取れなかった年は祝日なしとして計算を続ける
 */
export async function fetchHolidays(years: number[]): Promise<Set<string>> {
  const lists = await Promise.all(
    years.map(async (y) => {
      try {
        const res = await fetch(`https://holidays-jp.github.io/api/v1/${y}/date.json`, {
          // 祝日はめったに変わらないので、Cloudflare に1日キャッシュさせる
          cf: { cacheTtl: 86_400, cacheEverything: true },
        });
        if (!res.ok) return [];
        return Object.keys(await res.json<Record<string, string>>());
      } catch (e) {
        console.error('holidays fetch failed', y, e);
        return [];
      }
    }),
  );
  return new Set(lists.flat());
}

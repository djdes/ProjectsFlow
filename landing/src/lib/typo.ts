// Типографика заголовков: неразрывный пробел перед тире — строка не начинается с «—».
export function nbspDash(text: string): string {
  return text.replace(/ — /g, '\u00A0— ');
}

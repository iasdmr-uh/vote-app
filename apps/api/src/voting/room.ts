export function roomNumbers(present: number, accredited: number) {
  return { present, accredited, quorum: Math.ceil((2 * accredited) / 3) }
}

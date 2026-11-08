# Counting rules

How the tool works out the result of each ballot, with the source of every rule.

## Sources

Authority, highest first:

1. Reglamento Interno, June 2022 copy. It is not in this repo. Confirm the current edition with Secretaría.
2. Decisions confirmed by the maintainer, with their date.
3. `docs/scope.md`.
4. The code.

A rule with no Reglamento article is marked **Project decision** with its date.

## Terms

| Term | Meaning |
|---|---|
| Base | People in the room when the vote opens. Abstentions and inhabilitados count. Frozen at open |
| Majority | More than half of the base. With a base of 28, half is 14 and the majority is 15 |
| Seats | Places this vote fills. An office has 1. A committee of 5 has 5. A later vote has the seats still open |
| Line | The line under the last seat, after sorting by votes |
| Cut value | The vote count at the last seat |
| Tied at the cut | Candidates whose count equals the cut value, on both sides of the line |

The base counts people, never marks. A delegate can mark a candidate only once, so a candidate's votes are the number of delegates who chose them.

## Rules

| Rule | Applies to | Source |
|---|---|---|
| Majority: more than half of the base | Offices, committees, decisions | Reglamento 02-06 01: «las decisiones serán legales por la aprobación de la mitad más uno de los que componen la reunión» |
| Half plus one | Same rule as majority | Reglamento 02-06 01 |
| A tie for the last seats goes to a new secret vote among the tied | Offices, committees | Reglamento 05-12 03(6): «En caso de empate para el último o últimos puestos se procederá a una nueva votación entre los candidatos empatados. La votación será secreta.» |
| Candidates with a majority form the committee | Committees | Reglamento 05-12 03(5): «Los candidatos que reciban mayoría simple de votos conformarán la comisión» |
| Elected only inside the top N and with a majority | Offices, committees | Project decision, 2 Nov 2026 |
| Candidates above the line without a majority go to the next vote | Offices, committees | Project decision, 2 Nov 2026 |
| Add the next candidate when the next vote offers no choice | Offices, committees | Project decision, 2 Nov 2026 |
| Each delegate marks exactly the open seats | Committees and their later votes | Project decision, 2 Nov 2026 |
| New candidate allowed from the 3rd vote | Offices, committees | Project decision, 2 Nov 2026, explained by the union representatives |
| Regional secretary joins as one more secret voter, base + 1 | Offices, committees and Opciones decisions, from the 4th vote, after a tie at the cut. Stays for the later votes of that election while in the room | Reglamento 05-09 02: «El representante de la Conferencia General tendrá derecho a voto dirimente, cuando persiste un empate en las votaciones hasta tres votaciones.» 03-06 06 names the Secretario Regional as that representative. Mechanism is a project decision, 6 Nov 2026 |
| 3/4 of the base, rounded up | Decisions, when the ballot asks for it | Board decision, final, 8 Nov 2026 |
| A result is official only when its election is complete, with every seat filled. Until then it is preliminary | Offices, committees | Project decision, 8 Nov 2026 |
| 2/3 of the base, rounded up | Decisions, when the ballot asks for it. Not implemented yet | Reglamento 01-02 03: «sólo pueden ser modificados con las 2/3 partes de los votos de la Asamblea». Planned in #87 |

Reglamento 05-12 03 is written for the comisión de nombramiento. The tool applies it to every committee and office.

## How an election is counted

1. Sort candidates from most votes to fewest. Equal counts keep ballot order.
2. Read the count at the last seat. That is the cut value.
3. If candidates with the cut value sit on both sides of the line, the whole tied group goes to the next vote. None of them is elected.
4. Each candidate clearly above the cut is elected if they have a majority.
5. The next vote takes:
   - candidates above the line without a majority
   - the group tied at the cut
   - only if that leaves no more candidates than open seats, the next candidate below the line and anyone tied with them

Everyone else below the line is out. The next vote asks for the seats still open and needs a majority again.

## Examples

All examples have 28 delegates in the room, so the base is 28 and the majority is 15.

### Tie at the cut

Committee of 5. Each delegate marks 5 names, 140 marks.

```
place  name       votes  majority  result
  1    Isaías       28   yes       elected
  2    Jeremías     27   yes       elected
  3    Ezequiel     25   yes       elected
  4    Daniel       15   yes       next vote
  5    Oseas        15   yes       next vote   ← last seat, cut value 15
──────────────────────────────────────── line
  6    Joel         15   yes       next vote
  7    Amós         15   yes       next vote
```

- Daniel, Oseas, Joel and Amós have the cut value, so they are tied at the cut.
- Their majority does not elect them. Only ballot order puts Daniel and Oseas above the line, and delegates never voted on that order.
- Next vote: the four, for 2 seats. Each delegate marks 2 names.

### Several above the line without a majority

Committee of 3. Each delegate marks 3 names, 84 marks.

```
place  name       votes  majority  result
  1    Isaías       20   yes       elected
  2    Jeremías     14   no        next vote
  3    Ezequiel     13   no        next vote   ← last seat, cut value 13
──────────────────────────────────────── line
  4    Daniel       12             next vote, added for a choice
  5    Oseas        11             out
  6    Joel         10             out
  7    Amós          4             out
```

- Isaías is elected. Two seats stay open.
- Jeremías and Ezequiel alone would be 2 candidates for 2 seats. Every delegate would have to mark both, so the vote would offer no choice.
- Daniel, the next below the line, joins. If Oseas also had 12, Oseas would join too.
- Next vote: Jeremías, Ezequiel and Daniel, for 2 seats.

### More candidates with a majority than seats

Committee of 3, 84 marks.

```
place  name       votes  majority  result
  1    Isaías       25   yes       elected
  2    Jeremías     22   yes       elected
  3    Ezequiel     20   yes       elected     ← last seat, cut value 20
──────────────────────────────────────── line
  4    Daniel       17   yes       out
```

The most voted fill the seats. Daniel has a majority but is below the line with no tie.

### Ties away from the cut

Committee of 3, 84 marks.

```
place  name       votes  majority  result
  1    Isaías       22   yes       elected
  2    Jeremías     22   yes       elected
  3    Ezequiel     18   yes       elected     ← last seat, cut value 18
──────────────────────────────────────── line
  4    Daniel       11             out
  5    Oseas        11             out
```

Only a tie at the cut changes the result. The tie above the line and the tie below it change nothing.

### Tie at the cut and a tie above it

Committee of 3, 84 marks.

```
place  name       votes  majority  result
  1    Isaías       22   yes       elected
  2    Jeremías     22   yes       elected
  3    Ezequiel     18   yes       next vote   ← last seat, cut value 18
──────────────────────────────────────── line
  4    Daniel       18   yes       next vote
  5    Oseas         2             out
  6    Joel          2             out
```

- The tie between Isaías and Jeremías is above the cut, so both are elected.
- Ezequiel and Daniel are tied at the cut, so they go to the next vote for the 1 open seat. Two candidates for one seat is a real choice, so nobody is added.
- The tie between Oseas and Joel is below the line and changes nothing.

### Fewer candidates than seats

Committee of 3 with 2 candidates. How many names each delegate marks here is not settled, so the counts are only illustrative.

```
place  name       votes  majority  result
  1    Isaías       20   yes       elected
  2    Jeremías     16   yes       elected
```

Both are elected. The third seat stays open with no candidate for a next vote. No rule yet says how to fill it.

### Office with no majority

Office, 1 seat. Each delegate marks 1 name.

```
place  name       votes  majority  result
  1    Isaías       13   no        next vote   ← last seat, cut value 13
──────────────────────────────────────── line
  2    Jeremías     10             next vote, added for a choice
  3    Ezequiel      5             out
```

Isaías alone would offer no choice, so the next vote is between the top 2, plus anyone tied with the 2nd.

### Nobody voted

Every candidate has 0, so nobody has a majority and every candidate goes to the next vote. No special case.

## Later votes

| Vote | What changes |
|---|---|
| 2nd | Only the candidates from rule step 5. Exactly the open seats. Majority needed again |
| 3rd and later | The mesa may add a new candidate |
| 4th and later, after a tie at the cut | The mesa may add the regional secretary as one more secret voter. The base grows by 1. The secretary stays for the later votes of that election while in the room |

While seats stay open, the result is preliminary. People already elected show «Electo/a» and keep their seats while the later votes fill the rest. The result becomes official when the last seat is filled.

The tool and the mesa never choose between tied candidates. Only another vote separates them. No rule yet ends a chain that keeps tying.

## Decisions

| Format | Approved when | Otherwise |
|---|---|---|
| A favor / En contra | «A favor» reaches the threshold | Not approved, a tie included. Nothing repeats |
| Opciones | The most voted option reaches the threshold | The vote repeats between the top 2 and anyone tied with the 2nd. From the 4th vote, after a tie, the regional secretary may join |

Each delegate marks one option. The threshold is the majority, or 3/4 of the base rounded up when the ballot asks for it (base 28 → 21).

## Open questions

- Must all three earlier votes have tied before the regional secretary joins, or only the previous one?
- What ends a chain that keeps tying after the regional secretary joins?
- How is a seat filled when a committee has fewer candidates than seats?
- Confirm exact marks per ballot, including when marks equal candidates.
- Confirm that candidates above the line without a majority join the next vote, since the Reglamento covers only ties.

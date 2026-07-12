import { describe, expect, it } from "vitest";
import { TicketCodeGenerator, TicketCodeGeneratorError } from "./TicketCodeGenerator";

describe("TicketCodeGenerator", () => {
  it("génère des codes lisibles avec username égal au mot de passe par défaut", () => {
    const generator = new TicketCodeGenerator({ randomInt: createSequenceRandom([4, 8, 2, 7, 9, 3]) });

    const result = generator.generate({
      codeLength: 6,
      quantity: 1,
      routerId: "routeur-demo"
    });

    expect(result.codes.map((code) => code.username)).toEqual(["482793"]);
    expect(result.codes[0].passwordSecretRef).toBe("secret://routeur-demo/482793/password");
    expect(JSON.stringify(result)).not.toContain('"password":');
  });

  it("réessaie automatiquement en cas de collision locale", () => {
    const generator = new TicketCodeGenerator({
      randomInt: createSequenceRandom([4, 8, 2, 7, 5, 8, 3, 9, 6, 2, 5, 8, 9, 4, 7, 2, 3, 5, 8, 6])
    });

    const result = generator.generate({
      codeLength: 4,
      existingTickets: ["4827", { username: "5839" }],
      quantity: 3,
      routerId: "routeur-demo"
    });

    expect(result.collisionCount).toBe(2);
    expect(result.codes.map((code) => code.username)).toEqual(["6258", "9472", "3586"]);
  });

  it("applique un préfixe optionnel normalisé", () => {
    const generator = new TicketCodeGenerator({ randomInt: createSequenceRandom([7, 3, 8, 1, 4, 9]) });

    const result = generator.generate({
      codeLength: 3,
      prefix: " vip- ",
      quantity: 2,
      routerId: "routeur-demo"
    });

    expect(result.prefix).toBe("VIP");
    expect(result.codes.map((code) => code.username)).toEqual(["VIP738", "VIP149"]);
  });

  it("exclut les caractères ambigus quand l'option est activée", () => {
    const generator = new TicketCodeGenerator({
      randomInt: createSequenceRandom([0, 2, 5, 1, 4, 6, 3, 7, 2, 5, 0, 4, 6, 3, 1])
    });

    const numericResult = generator.generate({
      codeLength: 3,
      excludeAmbiguous: true,
      quantity: 5,
      routerId: "routeur-demo"
    });
    const readableResult = new TicketCodeGenerator().generate({
      alphabet: "readable",
      codeLength: 3,
      excludeAmbiguous: true,
      quantity: 30,
      routerId: "routeur-demo"
    });

    expect(numericResult.codes.map((code) => code.username)).toEqual(["247", "368", "594", "726", "853"]);
    expect(readableResult.codes.map((code) => code.username).join("")).not.toMatch(/[0OI1L]/);
  });

  it("rejette les codes faibles comme les répétitions et les suites simples", () => {
    const generator = new TicketCodeGenerator({
      randomInt: createSequenceRandom([2, 2, 2, 1, 2, 3, 4, 8, 2])
    });

    const result = generator.generate({
      codeLength: 3,
      quantity: 1,
      routerId: "routeur-demo"
    });

    expect(result.codes.map((code) => code.username)).toEqual(["482"]);
  });

  it("génère 1000 codes sans doublon", () => {
    const generator = new TicketCodeGenerator();

    const result = generator.generate({
      codeLength: 6,
      excludeAmbiguous: true,
      quantity: 1000,
      routerId: "routeur-demo"
    });
    const usernames = result.codes.map((code) => code.username);

    expect(usernames).toHaveLength(1000);
    expect(new Set(usernames)).toHaveLength(1000);
    expect(usernames.slice(0, 5)).not.toEqual(["222222", "222223", "222224", "222225", "222226"]);
  });

  it("refuse une quantité supérieure à la capacité disponible", () => {
    const generator = new TicketCodeGenerator();

    expect(() =>
      generator.generate({
        codeLength: 3,
        excludeAmbiguous: true,
        existingTickets: createExistingNumericCodes(510),
        quantity: 10,
        routerId: "routeur-demo"
      })
    ).toThrow(TicketCodeGeneratorError);
  });
});

function createSequenceRandom(values: number[]): (maxExclusive: number) => number {
  let index = 0;

  return (maxExclusive: number) => {
    const value = values[index % values.length] % maxExclusive;
    index += 1;
    return value;
  };
}

function createExistingNumericCodes(quantity: number): string[] {
  const alphabet = "23456789";
  const codes: string[] = [];

  for (const first of alphabet) {
    for (const second of alphabet) {
      for (const third of alphabet) {
        codes.push(`${first}${second}${third}`);

        if (codes.length === quantity) {
          return codes;
        }
      }
    }
  }

  return codes;
}

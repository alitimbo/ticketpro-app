import { render, screen } from "@testing-library/react";
import { Check } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Badge, Button, StatusDot } from ".";

describe("design system", () => {
  it("affiche les composants de base avec leurs états", () => {
    render(
      <div>
        <Button icon={Check} variant="primary">
          Valider
        </Button>
        <Badge status="warning">Avertissement</Badge>
        <StatusDot label="Hors ligne" status="offline" />
      </div>
    );

    expect(screen.getByRole("button", { name: "Valider" })).toBeInTheDocument();
    expect(screen.getByText("Avertissement")).toHaveClass("badge--warning");
    expect(screen.getByText("Hors ligne")).toHaveClass("status-dot--offline");
  });
});

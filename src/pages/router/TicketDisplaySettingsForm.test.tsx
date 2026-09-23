import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultTicketDisplaySettings } from "../../services/tickets";
import { TicketDisplaySettingsForm } from "./TicketDisplaySettingsForm";

describe("TicketDisplaySettingsForm", () => {
  it("verrouille la devise sur celle du plan pendant la génération", () => {
    const onChange = vi.fn();
    render(
      <TicketDisplaySettingsForm
        lockedCurrency="EUR"
        onChange={onChange}
        value={{ ...defaultTicketDisplaySettings, currency: "CFA" }}
      />
    );

    const currency = screen.getByDisplayValue("EUR");
    expect(currency).toBeDisabled();
    expect(screen.getByText(/définie par le plan sélectionné/i)).toBeInTheDocument();
    fireEvent.change(currency, { target: { value: "USD" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reste configurable lorsqu'aucun plan ne l'impose", () => {
    const onChange = vi.fn();
    render(
      <TicketDisplaySettingsForm
        onChange={onChange}
        value={{ ...defaultTicketDisplaySettings, currency: "CFA" }}
      />
    );

    fireEvent.change(screen.getByDisplayValue("CFA"), { target: { value: "XOF" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ currency: "XOF" }));
  });
  it("locks the data cap when the selected plan requires it", () => {
    render(
      <TicketDisplaySettingsForm
        dataLimitRequired
        onChange={vi.fn()}
        value={{ ...defaultTicketDisplaySettings, showDataLimit: false }}
      />
    );

    expect(screen.getByText("Volume de données obligatoire pour ce forfait")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume de données obligatoire pour ce forfait")).toBeDisabled();
  });
});

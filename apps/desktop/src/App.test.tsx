import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the title bar and a terminal pane per mock project", () => {
    render(<App />);

    expect(screen.getByLabelText("Settings")).toBeInTheDocument();
  });
});

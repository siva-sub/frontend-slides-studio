import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PresentationEntry } from "./PresentationViews";
import { presentationRoute } from "./lib/presentation";
import "./styles.css";

const Root = presentationRoute() ? PresentationEntry : App;
createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);

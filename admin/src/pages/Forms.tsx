import { Route, Routes } from "react-router-dom";
import FormEditor from "./FormEditor";
import FormsList from "./FormsList";

/** The Forms menu entry: the list at the root, the builder at /:documentId. */
const Forms = () => (
  <Routes>
    <Route index element={<FormsList />} />
    <Route path=":documentId" element={<FormEditor />} />
  </Routes>
);

export default Forms;

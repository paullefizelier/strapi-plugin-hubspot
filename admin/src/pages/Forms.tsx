import { Route, Routes } from "react-router-dom";
import FormEditor from "./FormEditor";
import FormsList from "./FormsList";
import Submissions from "./Submissions";

/**
 * The Forms menu entry: the list at the root, the submissions browser at
 * /submissions (static, so it wins over the param route), the builder at
 * /:documentId.
 */
const Forms = () => (
  <Routes>
    <Route index element={<FormsList />} />
    <Route path="submissions" element={<Submissions />} />
    <Route path=":documentId" element={<FormEditor />} />
  </Routes>
);

export default Forms;

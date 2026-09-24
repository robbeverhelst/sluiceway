# A second namespace, so a recording shows failures of two policies, one of
# them with markup and a line break in its message, which a row must escape,
# and one that is an object with a message and metadata.
package prod

import rego.v1

deny contains msg if {
  some step in input.steps
  step.op == "delete"
  msg := "no deletes in prod <b>bold</b> *star* [link](https://example.com) #123 @alice `tick` line one\nline two"
}

deny contains result if {
  input.steps[_].op == "delete"
  result := {"msg": "a structured message", "severity": "high"}
}

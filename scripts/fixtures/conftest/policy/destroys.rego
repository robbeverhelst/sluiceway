# The policies the Conftest fixtures are recorded with. Written in the Rego
# syntax OPA 1.0 made the default, with the import that lets Conftest 0.50.0
# read it too.
package main

import rego.v1

deny contains msg if {
  some step in input.steps
  step.op == "delete"
  msg := sprintf("%s must not be deleted", [step.urn])
}

warn contains msg if {
  some step in input.steps
  step.op == "replace"
  msg := sprintf("%s is replaced", [step.urn])
}

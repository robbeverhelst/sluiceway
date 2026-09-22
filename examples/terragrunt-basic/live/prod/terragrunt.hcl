include "root" {
  path = find_in_parent_folders("root.hcl")
}

terraform {
  source = "../../modules/notes"
}

inputs = {
  env  = "prod"
  motd = "hello"
}

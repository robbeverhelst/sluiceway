terraform {
  required_providers {
    random = { source = "hashicorp/random", version = "3.7.2" }
  }
}

resource "random_id" "zone" {
  byte_length = 4
}

resource "terraform_data" "record" {
  input = "CANARY-VALUE"
}
